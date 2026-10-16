# Mobilio

Сайт (`apps/web`) превращает адрес сайта в конфиг нативной iOS-оболочки (`apps/shell`), собирает
неподписанный `.ipa` через GitHub Actions (`macos-latest`, без подписи) и отдаёт файл на скачивание.

## Запуск apps/web на Windows

```
npm install
cd apps/web
npm run dev
```

Откроется на `http://localhost:3000`. На `/` вставь адрес сайта → «Создать приложение», дальше
редактирование на `/p/[id]`.

Переменные окружения — скопируй `apps/web/.env.example` в `apps/web/.env.local` и заполни (см.
ниже про токен и туннель):

```
cp apps/web/.env.example apps/web/.env.local
```

## Чтобы кнопка «Собрать .ipa» заработала целиком

GitHub Actions должен достучаться до твоего локального сервера (скачать конфиг/иконку, загрузить
`.ipa` обратно), поэтому `localhost` не подходит — нужен публичный туннель.

### 1. Запусти cloudflared-туннель

```
cloudflared tunnel --url http://localhost:3000
```

Команда выведет публичный адрес вида `https://random-words.trycloudflare.com` — это и есть
`PUBLIC_BASE_URL`. **Адрес меняется при каждом перезапуске туннеля** — после перезапуска обнови
секрет `PUBLIC_BASE_URL` в репозитории (см. ниже) и `PUBLIC_BASE_URL` в `apps/web/.env.local`.

### 2. Создай fine-grained GitHub-токен

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
- Repository access: только этот репозиторий (`serob111/iosmobilio2` или твой форк/копия);
- Permissions → Actions: **Read and write**.

Это и есть `GITHUB_TOKEN`.

### 3. Настрой секреты репозитория

Settings → Secrets and variables → Actions → Repository secrets:
- `BUILD_SECRET` — любая случайная строка (например, `openssl rand -hex 32`), одна и та же в
  секретах репозитория и в `apps/web/.env.local`;
- `PUBLIC_BASE_URL` — адрес туннеля из шага 1.

### 4. Заполни apps/web/.env.local

```
PUBLIC_BASE_URL=https://your-tunnel.trycloudflare.com
GITHUB_TOKEN=github_pat_...
GITHUB_REPO=serob111/iosmobilio2
GITHUB_REF=main
BUILD_SECRET=тот-же-секрет-что-в-репозитории
```

### Совет

Держи репозиторий **публичным** — на публичных репозиториях GitHub Actions даёт бесплатные минуты
на `macos-latest`-раннерах; на приватных macOS-минуты платные и расходуются быстро.

## Как это работает

1. `/` анализирует сайт (cheerio: название, иконка, цвет, до 4 вкладок из навигации), сохраняет
   конфиг в `data/projects/<id>/config.json` по zod-схеме (`packages/config`).
2. `/p/[id]` — правка конфига + кнопка «Собрать .ipa». Кнопка вызывает
   `POST /api/projects/[id]/build`, который запускает `.github/workflows/build-ipa.yml` через
   GitHub API (`workflow_dispatch`).
3. Workflow (на `macos-latest`) скачивает конфиг и иконку с сервера (`/api/build-config`,
   `/api/build-icon`, защищены заголовком `x-build-secret`), подставляет их в
   `apps/shell/project.config.json` + `apps/shell/src/config/generated.config.json`, собирает
   `expo prebuild` → `pod install` → `xcodebuild archive` (без подписи) → `.ipa`, загружает файл
   обратно (`POST /api/projects/[id]/ipa`) или сообщает об ошибке (`POST /api/projects/[id]/failed`).
4. `/p/[id]` опрашивает `GET /api/projects/[id]/build` каждые 10 секунд и показывает статус; при
   готовности — кнопка «Скачать .ipa» (`GET /api/projects/[id]/ipa`).

Можно запустить workflow и без сервера — вручную, с тестовым конфигом
(`apps/shell/test/test.config.json` + `test-icon.png`), не трогая реальный проект:

```
gh workflow run build-ipa.yml -f useTestConfig=true
```

## Неподписанный .ipa

Файл с сайта — неподписанный `.ipa`. Чтобы установить его на iPhone, его нужно подписать (например,
через Sideloadly обычным Apple ID) и подтвердить доверие разработчику на устройстве. Автоматическая
подпись и установка по ссылке — в планах.

## Структура репозитория

```
apps/shell/   — Expo-оболочка (SDK 57, expo-router)
apps/web/     — Next.js App Router: сайт, анализ сайтов, API сборки
packages/config/ — общая zod-схема конфига + утилиты (slug, bundleId, иконки)
data/projects/   — файловое хранилище проектов (в .gitignore)
.github/workflows/build-ipa.yml — сборка .ipa в GitHub Actions
```
