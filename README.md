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

## Локальное окружение (apps/api, apps/worker)

Postgres и Redis поднимаются в Docker, `api`/`worker`/`web` можно гонять нативно (быстрее при
разработке) или тоже в контейнерах.

### Вариант 1 — инфраструктура в Docker, приложения нативно

```
npm install
npm run dev
```

Поднимет `postgres`+`redis` через Docker Compose, затем параллельно запустит `web`, `api`, `worker`
(`concurrently`). Только инфраструктуру — `npm run dev:infra`.

### Вариант 2 — всё в Docker

```
docker compose up
```

Перед первым запуском скопируй `.env.example` → `.env` в `apps/api` и `apps/worker` (и при желании
заполни `SENTRY_DSN`).

`GET /health` на `api` проверяет живость Postgres и Redis и отвечает 200/503.

## Тесты и CI

```
npm run typecheck   # tsc --noEmit по всем workspace'ам
npm run lint         # eslint по всем workspace'ам
npm run test         # vitest по всем workspace'ам (packages/config, apps/web, apps/api, apps/worker)
npm run test:coverage  # то же + покрытие (порог 80% для packages/config и apps/web/lib)
cd apps/web && npm run test:e2e   # Playwright: create → edit → build → download
```

Тесты, которым нужны живые Postgres/Redis (health-check api, BullMQ-воркер), сами пропускаются
локально, если `DATABASE_URL`/`REDIS_URL` не заданы — поднимите инфраструктуру (`npm run dev:infra`)
и экспортируйте переменные из `apps/api/.env.example`/`apps/worker/.env.example`, чтобы прогнать их
по-настоящему.

`.github/workflows/ci.yml` гоняет lint/typecheck/test:coverage на каждый push и PR (с
Postgres/Redis как `services:`), и Playwright E2E — на PR в `main`.

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
apps/api/     — NestJS: health-check (Postgres+Redis), очередь (BullMQ) — каркас для следующих этапов
apps/worker/  — BullMQ-воркер — каркас для следующих этапов
packages/config/   — общая zod-схема конфига + утилиты (slug, bundleId, иконки)
packages/repacker/ — пусто, заготовка под будущую логику репака
data/projects/   — файловое хранилище проектов (в .gitignore)
docker-compose.yml — Postgres, Redis, api, worker
.github/workflows/build-ipa.yml — сборка .ipa в GitHub Actions
.github/workflows/ci.yml        — lint/typecheck/test на push+PR, Playwright E2E на PR в main
```
