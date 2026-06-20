export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: {}, error: new Error('Supabase desactivado. Usa PocketBase.') }),
    signUp: async () => ({ data: {}, error: new Error('Supabase desactivado. Usa PocketBase.') }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: new Error('Supabase desactivado. Usa PocketBase.') }),
    updateUser: async () => ({ data: {}, error: new Error('Supabase desactivado. Usa PocketBase.') }),
    signInWithOAuth: async () => ({ data: {}, error: new Error('Supabase desactivado. Usa PocketBase.') }),
  },
  from: () => ({
    select: () => ({ eq: () => ({ in: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }), data: null, error: null }) }) }),
    upsert: () => Promise.resolve({ data: null, error: new Error('Supabase desactivado') }),
    insert: () => Promise.resolve({ data: null, error: new Error('Supabase desactivado') }),
    delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  }),
  removeChannel: () => {},
  channel: () => ({
    on: () => ({ subscribe: () => {} }),
    unsubscribe: () => {},
  }),
};

export const subscribeToTable = async () => () => {};
export const startPolling = async () => () => {};
