import { Unbounded, Onest } from 'next/font/google';

export const unbounded = Unbounded({
  variable: '--font-unbounded',
  weight: ['700', '800'],
  subsets: ['latin', 'cyrillic'],
});

export const onest = Onest({
  variable: '--font-onest',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin', 'cyrillic'],
});
