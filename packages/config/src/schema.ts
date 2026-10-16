import { z } from 'zod';

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Цвет должен быть в формате #RRGGBB');

const bundleIdPattern = /^[a-z0-9]+(\.[a-z0-9]+)+$/;

const UrlSourceSchema = z.object({
  type: z.literal('url'),
  url: z.string().url('Укажите корректный адрес сайта'),
});

const HtmlSourceSchema = z.object({
  type: z.literal('html'),
  entry: z.string().min(1, 'Укажите имя файла входной страницы (например, index.html)'),
});

const ThemeSchema = z.object({
  primary: hexColor,
  background: hexColor,
  statusBar: z.enum(['dark', 'light'], {
    errorMap: () => ({ message: 'statusBar должен быть "dark" или "light"' }),
  }),
});

const TabSchema = z
  .object({
    title: z.string().min(1, 'У вкладки должно быть название'),
    icon: z.string().min(1, 'У вкладки должна быть иконка'),
    path: z.string().min(1).optional(),
    native: z.literal('contacts').optional(),
  })
  .refine((tab) => Boolean(tab.path) !== Boolean(tab.native), {
    message: 'У вкладки должно быть указано ровно одно из полей: path или native',
  });

const OnboardingSlideSchema = z.object({
  title: z.string().min(1, 'У слайда онбординга должен быть заголовок'),
  text: z.string().min(1, 'У слайда онбординга должен быть текст'),
});

const NativeScreensSchema = z
  .object({
    onboarding: z
      .object({
        enabled: z.boolean(),
        slides: z.array(OnboardingSlideSchema).default([]),
      })
      .optional(),
    contacts: z
      .object({
        phone: z.string().optional(),
        address: z.string().optional(),
        mapUrl: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const FeaturesSchema = z
  .object({
    offline: z.boolean().default(true),
    share: z.boolean().default(true),
    deepLinks: z.boolean().default(false),
    pullToRefresh: z.boolean().default(true),
  })
  .default({});

export const ProjectConfigSchema = z
  .object({
    id: z.string().min(1, 'Отсутствует идентификатор проекта'),
    name: z.string().min(1, 'Укажите название приложения').max(50, 'Название слишком длинное'),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'slug может содержать только латинские буквы в нижнем регистре, цифры и дефис'),
    bundleId: z
      .string()
      .regex(bundleIdPattern, 'bundleId должен быть в формате com.example.name'),
    source: z.discriminatedUnion('type', [UrlSourceSchema, HtmlSourceSchema]),
    theme: ThemeSchema,
    tabs: z
      .array(TabSchema)
      .min(1, 'Должна быть хотя бы одна вкладка')
      .max(5, 'Не может быть больше 5 вкладок'),
    nativeScreens: NativeScreensSchema,
    features: FeaturesSchema,
    allowedDomains: z.array(z.string().min(1)).default([]),
    privacyPolicyUrl: z.string().url('Укажите корректную ссылку на политику конфиденциальности').optional(),
    trial: z.boolean(),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>;
