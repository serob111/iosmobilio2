import { Unbounded, Onest } from 'next/font/google';

export const unbounded = Unbounded({
  variable: '--font-unbounded',
  weight: ['500', '700', '800'],
  subsets: ['latin'],
});

export const onest = Onest({
  variable: '--font-onest',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});
