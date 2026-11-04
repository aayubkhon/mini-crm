import { z } from 'zod';

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .refine((key) => !key.startsWith('sb_secret_'), 'Секретный ключ в приложении использовать нельзя'),
});

const parsed = envSchema.safeParse(import.meta.env);

export const envError = parsed.success
  ? null
  : 'Заполните VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env.local (образец: .env.example). Секретный ключ использовать нельзя.';

export const env = parsed.success ? parsed.data : null;
