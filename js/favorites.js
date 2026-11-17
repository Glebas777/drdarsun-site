import { supabase } from './supabase-client.js';

export async function getFavoriteIds(userId) {
    const { data, error } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', userId);
    if (error) throw error;
    return new Set((data || []).map(item => String(item.product_id)));
}

export async function toggleFavorite(userId, productId) {
    const normalizedId = String(productId);
    const { data: existing, error: lookupError } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', userId)
        .eq('product_id', normalizedId)
        .maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
        const { error } = await supabase
            .from('favorites')
            .delete()
            .eq('user_id', userId)
            .eq('product_id', normalizedId);
        if (error) throw error;
        return false;
    }

    const { error } = await supabase.from('favorites').insert({
        user_id: userId,
        product_id: normalizedId
    });
    if (error) throw error;
    return true;
}

export async function getFavoriteProducts(userId) {
    const ids = await getFavoriteIds(userId);
    if (ids.size === 0) return [];

    const { data, error } = await supabase
        .from('products')
        .select('id,name,price,description,image_url,category')
        .in('id', [...ids]);
    if (error) throw error;
    return data || [];
}
