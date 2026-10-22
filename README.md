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

Postgres, Redis и MinIO (объектное хранилище) поднимаются в Docker, `api`/`worker`/`web` можно
гонять нативно (быстрее при разработке) или тоже в контейнерах.

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
заполни `SENTRY_DSN`, `GOOGLE_CLIENT_ID`/`SECRET`, `RESEND_API_KEY` — все опциональны, см. ниже).
`migrate`-сервис сам поднимет роли и применит миграции перед стартом `api`/`worker`
(`depends_on: service_completed_successfully`) — отдельный шаг не нужен.

`GET /health` на `api` проверяет живость Postgres и Redis и отвечает 200/503.

## Хранилище файлов (MinIO / R2)

Иконки проектов и собранные `.ipa` лежат в объектном хранилище, а не на диске — интерфейс
`ObjectStorage` (`packages/storage`) оборачивает S3-совместимый API. Локально и в CI это MinIO
(контейнер `minio` в `docker-compose.yml`), в проде — Cloudflare R2 (просто другой `S3_ENDPOINT`,
без `S3_FORCE_PATH_STYLE`). Ключи объектов: `orgs/<orgId>/projects/<projectId>/icon.png`,
`.../builds/<buildId>/app.ipa` — см. `packages/storage/src/keys.ts`. Скачивание — только по
коротким подписанным ссылкам (`ObjectStorage.signedUrl`), объекты не публичны.

MinIO-образ — `cgr.dev/chainguard/minio`, не `minio/minio`/`bitnami/minio` с Docker Hub: оба
теперь требуют авторизацию даже для анонимного `docker pull` (изменилось в 2025 году), Chainguard
пока отдаёт `:latest` без логина. Он работает под непривилегированным пользователем, который не
может писать в `/data` без `user: "0"` в compose (только для dev/CI-инфраструктуры, не для прода —
в проде это R2, никакого контейнера нет). В образе нет `curl`/`wget`, поэтому healthcheck — просто
TCP-коннект через `bash`'s `/dev/tcp`, а не HTTP-пробинг.

Бакет MinIO не создаётся сам — ни `minio/mc`, ни `amazon/aws-cli` сейчас не тянутся анонимно, так
что бакет создаёт одноразовый сервис `createbucket` (`packages/storage/src/scripts/ensure-bucket.ts`),
который делает это через уже используемый `@aws-sdk/client-s3`, без отдельного CLI-образа.

## База данных: миграции, роли, RLS

Схема и миграции — в `packages/db` (Drizzle ORM). Две роли Postgres, не одна:

- **`mobilio_migrator`** — владелец схемы, запускает миграции (создание таблиц, RLS-политики).
- **`mobilio_app`** — без `BYPASSRLS`, не владелец таблиц; от её имени работает `api`. Даже баг в
  коде приложения не даст прочитать чужие данные — это гарантирует сама Postgres через RLS, а не
  дисциплина разработчика.

Обе роли создаёт `packages/db/sql/0000_bootstrap_roles.sql` (идемпотентно — безопасно гонять
повторно), выполняя его от имени суперпользователя кластера (`POSTGRES_BOOTSTRAP_URL`) — только
этот шаг требует суперпользователя, дальше всё идёт от `mobilio_migrator`.

### Применить миграции вручную

```
cp packages/db/.env.example packages/db/.env   # локально — localhost:5433, см. комментарии в файле
npm run db:migrate --workspace=@mobilio/db
```

В docker-compose и CI это уже сделано за тебя (`migrate`-сервис / шаг `Run database migrations`).

### RLS: как это работает

Каждая таблица с `org_id` (`memberships`, `invitations`, `projects`) и `organizations` сама (по
`id`, а не `org_id` — она и есть организация) имеет `ENABLE` + `FORCE ROW LEVEL SECURITY` —
политика действует даже для владельца таблицы (`mobilio_migrator`), не только для `mobilio_app`.
Базовая политика: строка видна/доступна для записи, только если её `org_id` (или, для
`organizations`, `id`) совпадает с `current_setting('app.org_id')` — а эту настройку выставляет
**transaction-scoped** `SET LOCAL` внутри `runInTenantContext()` (`packages/db/src/tenant-context.ts`),
единственная санкционированная точка входа к этим таблицам. Вне транзакции (или без вызова
`runInTenantContext`) настройка не задана — запрос вернёт 0 строк, а не ошибку (fail closed).

Три частных случая решены дополнительными, более узкими политиками (все — только `SELECT`,
не ослабляют `INSERT`/`UPDATE`/`DELETE`):
- **Список «мои организации»** (`GET /me`) не укладывается в «один org_id на транзакцию» —
  `runInUserContext()` выставляет только `app.user_id`. Отдельная политика на `memberships`
  разрешает видеть свои же строки по `user_id`, вне зависимости от `org_id`, и такая же — на
  `organizations` (через `EXISTS`-подзапрос к `memberships`, который сам подчиняется той же
  политике). Обе строго гейтятся на отсутствие `app.org_id`, иначе это же правило дало бы
  просочиться чужим организациям в обычный запрос, скоупленный per-org.
- **Принятие приглашения** требует найти инвайт по токену до того, как известна организация —
  `runInTokenLookupContext()` выставляет `app.lookup_token_hash`; безопасно, поскольку это
  SHA-256 случайного токена, и совпадение само по себе уже доказывает право на чтение той строки.

**Таблицы Better Auth (`users`, `sessions`, `accounts`, `verifications`) RLS намеренно не имеют** —
это глобальные таблицы identity-слоя, не организации, и `org_id` у них нет и не предполагается. Их
единственный предписанный потребитель — сам Better Auth (через Drizzle-адаптер в `auth/build-auth.ts`)
и код модуля `auth`; остальной код не должен обращаться к ним напрямую — пользоваться сессией/личностью
нужно через `request.user`, который выставляет `AuthGuard`, а не прямым запросом к `users`.

**Защита «последнего owner» от гонки** (`changeRole`/`removeMember`): подсчёт владельцев
(`assertNotLastOwner` в `organizations.service.ts`) блокирует строки `role = 'owner'` через
`SELECT ... FOR UPDATE` перед подсчётом. Без этого два параллельных понижения/удаления разных
владельцев одной организации могли бы оба увидеть «ещё есть другой owner» из своего снапшота до
коммита другого — и организация осталась бы вообще без владельцев. С блокировкой вторая транзакция
ждёт коммита первой и пересчитывает уже по актуальным данным.

**Принятие приглашения дважды** (двойной клик, повторный запрос) не 500-ит: вставка membership идёт
через `ON CONFLICT (user_id, org_id) DO NOTHING`, а не «проверить, потом вставить» — та схема была
гонибельна (обе параллельные проверки могли увидеть «записи ещё нет» до того, как любая вставила).

### Переменные для auth (apps/api)

```
BETTER_AUTH_SECRET=...        # обязательна, см. apps/api/.env.example
API_BASE_URL=http://localhost:3011
WEB_ORIGIN=http://localhost:3000   # CORS + куда ведут magic-link ссылки

GOOGLE_CLIENT_ID=             # опционально — без них вход через Google просто выключен
GOOGLE_CLIENT_SECRET=

RESEND_API_KEY=               # опционально — без ключа письма пишутся в лог (dev), не отправляются
MAIL_FROM=Mobilio <noreply@mobilio.app>
```

## Тесты и CI

```
npm run typecheck   # tsc --noEmit по всем workspace'ам
npm run lint         # eslint по всем workspace'ам
npm run test         # vitest по всем workspace'ам (packages/config, apps/web, apps/api, apps/worker)
npm run test:coverage  # то же + покрытие (порог 80%: packages/config, apps/web/lib, apps/api auth+organizations)
cd apps/web && npm run test:e2e   # Playwright: create→build→download, и полный auth-флоу (apps/web/e2e/auth.spec.ts)
```

Тесты, которым нужны живые Postgres/Redis (health-check api, BullMQ-воркер, миграции, auth/organizations
HTTP-флоу), сами пропускаются локально, если нужные переменные не заданы — поднимите инфраструктуру
(`npm run dev:infra`), примените миграции (см. «База данных» выше) и экспортируйте переменные из
`apps/api/.env.example`/`apps/worker/.env.example`/`packages/db/.env.example`, чтобы прогнать их
по-настоящему. `npm run test:e2e` поднимает настоящий `api` (не мок) — тот же набор переменных нужен
и ему, через `E2E_API_DATABASE_URL`/`E2E_API_REDIS_URL` (см. `apps/web/playwright.config.ts`).

`.github/workflows/ci.yml` гоняет lint/typecheck/test:coverage на каждый push и PR (с Postgres/Redis
как `services:` + применением миграций), и Playwright E2E — на PR в `main` (тоже с Postgres/Redis +
миграциями, для auth-теста).

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

## Авторизация и организации (apps/api)

Вход — magic link на почту (пишется в лог в dev, см. выше) или Google OAuth; сессия — httpOnly
cookie, общая для `apps/web` и `apps/api` (разные origin, один site — CORS с `credentials: true` на
`api`). При первом входе автоматически создаётся личная организация, пользователь в ней — owner.

```
GET  /me                                 — пользователь + его организации
POST /orgs                               — создать организацию
GET  /orgs/:orgId                        — организация + участники (только для участников)
POST /orgs/:orgId/invitations            — пригласить по email (owner/admin)
DELETE /orgs/:orgId/invitations/:id      — отозвать приглашение (owner/admin)
POST /invitations/accept                 — принять приглашение по токену (не требует членства)
PATCH  /orgs/:orgId/members/:userId      — сменить роль (owner/admin; последнего owner понизить нельзя)
DELETE /orgs/:orgId/members/:userId      — удалить участника (owner/admin; последнего owner удалить нельзя)
```

Все ошибки — `{ error: { code, message, requestId } }`. Доступ к чужой организации — `404`, не
`403` (не раскрывает, существует ли она). В `apps/web` пока только шапка (пользователь + переключатель
организаций) и `/login`/`/logout` — страниц для приглашений/управления участниками ещё нет, эти
действия проверяются через прямые вызовы API (см. `apps/web/e2e/auth.spec.ts`).

## Структура репозитория

```
apps/shell/   — Expo-оболочка (SDK 57, expo-router)
apps/web/     — Next.js App Router: сайт, анализ сайтов, API сборки, вход/выход, шапка
apps/api/     — NestJS: auth (Better Auth), организации, health-check, очередь (BullMQ)
apps/worker/  — BullMQ-воркер — каркас для следующих этапов
packages/config/   — общая zod-схема конфига + утилиты (slug, bundleId, иконки)
packages/db/       — Drizzle-схема, миграции, роли/RLS, TenantContext (см. выше)
packages/repacker/ — пусто, заготовка под будущую логику репака
data/projects/   — файловое хранилище проектов (в .gitignore)
docker-compose.yml — Postgres, Redis, migrate (роли+миграции), api, worker
.github/workflows/build-ipa.yml — сборка .ipa в GitHub Actions
.github/workflows/ci.yml        — lint/typecheck/test на push+PR; Playwright E2E (создание .ipa +
                                   полный auth-флоу через реальный api) на PR в main
```
