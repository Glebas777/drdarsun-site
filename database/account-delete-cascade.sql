do $$
declare
    fk record;
    user_table record;
    definition text;
    orphaned boolean;
    constraint_name text;
    constraint_suffix integer;
begin
    if to_regclass('auth.users') is null then
        raise exception 'auth.users was not found; run this script in the Supabase project database.';
    end if;

    for fk in
        select
            c.oid,
            c.conrelid,
            c.conname,
            pg_get_constraintdef(c.oid) as definition
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f'
          and c.confrelid = 'auth.users'::regclass
          and n.nspname = 'public'
          and c.confdeltype <> 'c'
          and c.conparentid = 0
    loop
        definition := regexp_replace(
            fk.definition,
            '\s+ON DELETE (NO ACTION|RESTRICT|SET NULL|SET DEFAULT|CASCADE)(\s*\([^)]*\))?',
            '',
            'i'
        );
        definition := regexp_replace(
            definition,
            '(REFERENCES\s+auth\.users\s*\([^)]*\))',
            '\1 ON DELETE CASCADE',
            'i'
        );

        if definition = fk.definition then
            raise exception 'Could not safely update foreign key %.%', fk.conrelid::regclass, fk.conname;
        end if;

        execute format('alter table %s drop constraint %I', fk.conrelid::regclass, fk.conname);
        execute format(
            'alter table %s add constraint %I %s',
            fk.conrelid::regclass,
            fk.conname,
            definition
        );
    end loop;

    for user_table in
        select
            table_class.oid as table_oid,
            table_class.relname as table_name,
            user_column.attnum as user_attnum
        from pg_class table_class
        join pg_namespace table_schema on table_schema.oid = table_class.relnamespace
        join pg_attribute user_column on user_column.attrelid = table_class.oid
        where table_schema.nspname = 'public'
          and table_class.relkind in ('r', 'p')
          and user_column.attname = 'user_id'
          and user_column.atttypid = 'uuid'::regtype
          and user_column.attnum > 0
          and not user_column.attisdropped
          and not exists (
              select 1
              from pg_constraint existing_fk
              where existing_fk.contype = 'f'
                and existing_fk.conrelid = table_class.oid
                and existing_fk.confrelid = 'auth.users'::regclass
                and user_column.attnum = any(existing_fk.conkey)
          )
    loop
        execute format(
            'select exists (
                select 1
                from %s as dependent
                where dependent.user_id is not null
                  and not exists (
                      select 1
                      from auth.users as account
                      where account.id = dependent.user_id
                  )
            )',
            user_table.table_oid::regclass
        ) into orphaned;

        if orphaned then
            raise exception 'Table public.% has user_id values without a matching auth.users row; clean or map them before rerunning this script.',
                user_table.table_name;
        end if;

        constraint_name := left(user_table.table_name || '_user_id_auth_users_fkey', 63);
        constraint_suffix := 0;
        while exists (
            select 1
            from pg_constraint existing_constraint
            where existing_constraint.conrelid = user_table.table_oid
              and existing_constraint.conname = constraint_name
        ) loop
            constraint_suffix := constraint_suffix + 1;
            constraint_name := left(
                user_table.table_name,
                63 - length('_user_id_auth_users_fkey_' || constraint_suffix::text)
            ) || '_user_id_auth_users_fkey_' || constraint_suffix::text;
        end loop;
        execute format(
            'alter table %s add constraint %I foreign key (user_id) references auth.users (id) on delete cascade',
            user_table.table_oid::regclass,
            constraint_name
        );
    end loop;
end;
$$;
