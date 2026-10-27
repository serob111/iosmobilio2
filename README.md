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

## Чтобы сборка .ipa заработала целиком (Этап 2: через apps/api)

Начиная с Этапа 2 сборки создаются и отслеживаются через `apps/api`, а не через `apps/web` —
GitHub Actions — это просто текущий исполнитель, с которым `api` общается по одноразовому
токену конкретной сборки (см. «Сборки (apps/api)» ниже). GitHub Actions должен достучаться до
твоего локального `api` (скачать конфиг/иконку, загрузить `.ipa` обратно), поэтому `localhost`
не подходит — нужен публичный туннель **до `api`** (не до `web`, как было в Этапе 0/1).

### 1. Запусти cloudflared-туннель до локального api

```
cloudflared tunnel --url http://localhost:3011
```

Команда выведет публичный адрес вида `https://random-words.trycloudflare.com` — это и есть
`API_PUBLIC_URL`. **Адрес меняется при каждом перезапуске туннеля** — после перезапуска обнови
`API_PUBLIC_URL` в `apps/api/.env`.

### 2. Создай fine-grained GitHub-токен

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
- Repository access: только этот репозиторий (`serob111/iosmobilio2` или твой форк/копия);
- Permissions → Actions: **Read and write**.

Это и есть `GITHUB_DISPATCH_TOKEN`.

### 3. Сгенерируй BUILD_TOKEN_KEY и добавь его в секреты репозитория

```
openssl rand -base64 32
```

Это значение идёт **и** в `apps/api/.env` (`BUILD_TOKEN_KEY`), **и** в секрет репозитория
`BUILD_TOKEN_KEY` (Settings → Secrets and variables → Actions → New repository secret) —
один и тот же ключ на обеих сторонах. `api` шифрует одноразовый токен сборки этим ключом
(AES-256-GCM) перед тем, как он попадёт в workflow_dispatch; воркфлоу расшифровывает его
тем же ключом на стороне GitHub (см. «Сборки» ниже).

### 4. Заполни apps/api/.env

```
BUILD_RUNNER=github
API_PUBLIC_URL=https://your-tunnel.trycloudflare.com
GITHUB_DISPATCH_TOKEN=github_pat_...
GITHUB_REPO=serob111/iosmobilio2
GITHUB_WORKFLOW=build-ipa.yml
GITHUB_REF=main
BUILD_TOKEN_KEY=<то же значение, что в секрете репозитория>
```

### 5. Создай сборку

Сессионной cookie из обычного входа (см. «Авторизация и организации» ниже) и существующего
проекта достаточно:

```
curl -X POST http://localhost:3011/orgs/<orgId>/projects/<projectId>/builds \
  -H "Cookie: better-auth.session_token=..."
```

`api` сам вызовет `workflow_dispatch` с `buildId`/зашифрованным токеном
(`buildTokenEnc`)/`baseUrl=API_PUBLIC_URL` — дальше workflow сам пройдёт `decrypt → start →
config → icon → сборка → upload`, не трогая `apps/web`. Статус —
`GET /orgs/<orgId>/projects/<projectId>/builds/<buildId>`, готовый файл —
`GET .../builds/<buildId>/ipa` (302 на подписанную ссылку).

### 6. Проверь, что токен не попал в лог открытым текстом

Открой сам run в GitHub Actions UI (Actions → build-ipa → этот run) и разверни каждый шаг,
особенно «Decrypt build token», «Report build started», «Fetch project config (apps/api)»,
«Upload .ipa to apps/api» — везде, где видна `Authorization: Bearer ***`, токен должен быть
замаскирован звёздочками (`::add-mask::` в шаге «Decrypt build token» это гарантирует), а не
виден как hex-строка. Это нужно проверять вручную один раз после любого изменения
`build-ipa.yml`, трогающего токен — автоматически (в CI) этот прогон не гоняется.

### Совет

Держи репозиторий **публичным** — на публичных репозиториях GitHub Actions даёт бесплатные минуты
на `macos-latest`-раннерах; на приватных macOS-минуты платные и расходуются быстро.

## Локальное окружение (apps/api, apps/worker)

Node — одна версия везде: `22.x` (`.nvmrc`, корневой `package.json`'s `engines.node`, от
которого отталкивается CI через `node-version-file`, и все `Dockerfile`). `apps/api`'s
`undici` зависимость закреплена на точную версию (`6.21.2`), совпадающую с той, что
встроена в Node 22 (`process.versions.undici`) — `safeFetch` передаёт собственный
`undici.Agent` как `dispatcher` в глобальный `fetch`, и версия пакета должна совпадать с
версией, встроенной в саму Node, иначе `Agent` из другой линии undici может повести себя
не так, как ожидается.

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

Этап 0/1: `/` анализировал сайт и правка шла через `apps/web`'s файловое хранилище
(`data/projects/<id>/config.json`), а кнопка «Собрать .ipa» сама дёргала GitHub API. С Этапа 2
анализ сайта и проекты уже живут в `apps/api` (см. «Проекты» ниже), а сборки — тоже через
`apps/api`, не через `apps/web` (см. «Сборки» ниже): `apps/web`'s старые роуты
(`/api/projects/[id]/build`, `/api/build-config`, `/api/build-icon`, `/api/projects/[id]/ipa`,
`/api/projects/[id]/failed`) больше не используются воркфлоу и будут удалены отдельным шагом, когда
`apps/web`'s фронтенд переключится на вызовы `api` напрямую.

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

## Проекты (apps/api)

Логика анализа сайта (`analyzeSite`) и обработки иконки перенесена из `apps/web` в
`apps/api/src/projects` — `apps/web` пока держит свою копию (удалится, когда сам `apps/web`
начнёт звать `api` вместо файлового хранилища, см. план Этапа 2). Эндпоинты — под
`OrgGuard`/`ProjectGuard`, доступны любому участнику организации (без ограничения по роли):

```
POST /orgs/:orgId/projects               — { url } → анализ сайта → создание проекта
GET  /orgs/:orgId/projects               — список проектов организации (без полного config)
GET  /orgs/:orgId/projects/:projectId    — проект (id, config, configVersion)
PUT  /orgs/:orgId/projects/:projectId    — полная замена config (валидация как при создании)
POST /orgs/:orgId/projects/:projectId/icon — загрузка иконки (multipart, поле "icon")
GET  /orgs/:orgId/projects/:projectId/icon — 302 на подписанную ссылку в object storage
```

`projects.config` — jsonb, валидируется `@mobilio/config`'s `ProjectConfigSchema` при каждой
записи; `projects.config_version` фиксирует, под какую версию схемы подогнан конкретный ряд
(см. `CONFIG_SCHEMA_VERSION` там же) — на случай будущей миграции формы конфига.

## Сборки (apps/api/src/builds)

Сборки создаются и отслеживаются через `api`; GitHub Actions — лишь текущий исполнитель, который
общается с `api` по одноразовому токену конкретной сборки. Позже его заменит перепаковка шаблона
(`packages/repacker`), поэтому весь код вне `apps/api/src/builds` знает только интерфейс
`BuildRunner { dispatch(build: {id, token, baseUrl}): Promise<void> }` — не GitHub напрямую.
`GithubActionsRunner` (REST `workflow_dispatch`) — единственная реальная реализация;
`FakeRunner` — для тестов/локалки (`BUILD_RUNNER=fake`, см. `.env.example`), просто запоминает
диспатч вместо реального вызова.

Пользовательские эндпоинты (сессия + `OrgGuard` + `ProjectGuard`):

```
POST /orgs/:orgId/projects/:projectId/builds          — создать сборку → 201 {id, status:'queued'}
GET  /orgs/:orgId/projects/:projectId/builds          — последние 20
GET  /orgs/:orgId/projects/:projectId/builds/:buildId
GET  /orgs/:orgId/projects/:projectId/builds/:buildId/ipa — 302 на подписанную ссылку (только status=done)
```

Одна активная (`queued`/`building`) сборка на проект — гарантирует не предварительная проверка, а
частичный уникальный индекс (`builds_one_active_per_project`); вторая параллельная попытка ловит
unique-violation от самой Postgres и превращается в `409 BUILD_IN_PROGRESS`. Создание сборки также
ограничено rate-limit'ом по организации (10 в час, Redis fixed-window). Если `BuildRunner.dispatch`
упал — сборка сразу помечается `failed`, ответ — `502 BUILD_DISPATCH_FAILED`.

Эндпоинты раннера (`@Public()`, авторизация `Authorization: Bearer <buildToken>` через
`BuildRunnerGuard`):

```
POST /builds/:id/start  { runId, runUrl }   — queued → building (повторный вызов идемпотентен)
GET  /builds/:id/config                     — { config, templateVersion }
GET  /builds/:id/icon                       — PNG потоком из object storage
POST /builds/:id/ipa                        — потоковая загрузка .ipa → done, лимит 300 МБ
POST /builds/:id/fail  { error }            — queued/building → failed
```

Переходы статуса — только `queued → building → done|failed` и `queued → failed`; любой другой —
`409 INVALID_BUILD_STATE`. Токен (`sha256`-хеш в БД; сырой уходит раннеру только через
`BuildRunner.dispatch()` — для GitHub Actions он же шифруется AES-256-GCM`'ом перед dispatch, см.
ниже) живёт 2 часа, но очищается (`token_hash = NULL`) сразу при переходе в `done`/`failed` — раньше
истечения TTL. RLS (`builds_token_select`/`builds_token_update`, см. `0009_builds_token_access.sql` +
`0011_builds_token_update_tighten.sql`) пускает по `token_hash` + `token_expires_at > now()` +
`status IN ('queued','building')` — те же условия в `USING`, а `WITH CHECK` — `status IN
('building','done','failed') AND (token_hash IS NULL OR token_hash совпадает)`: разрешённые переходы
двигают строку *вне* состояния, что требует `USING` (копировать его в `WITH CHECK` сломало бы ровно
эти обновления), но `WITH CHECK` всё равно не безусловный `true` — подделать `token_hash` на чужой
или откатить статус в `queued` через этот путь нельзя. Отдельный `BEFORE UPDATE`-триггер
(`builds_immutable_fields`) не даёт поменять `id`/`org_id`/`project_id`/`created_at` вообще никаким
`UPDATE`, независимо от того, какая RLS-политика его пропустила. У раннера нет пользовательской
идентичности вообще — `runInBuildContext` (`packages/db/src/tenant-context.ts`) не выставляет
`app.user_id` и не выставляет `app.org_id` (а значит не даёт раннеру видеть весь органайзер — только
`app.lookup_token_hash` для поиска сборки, затем `app.build_project_id` из уже найденной строки, так
что раннер видит/читает ровно один свой проект через `projects_build_runner_select`, не всю org).
`BuildRunnerGuard` дополнительно сверяет хеши `timingSafeEqual` после самого запроса — защита в
глубину, на случай если совпадение на стороне БД когда-нибудь ослабнет. Любая проблема с токеном
(не найден, истёк, не тот статус) — одинаковый `404 BUILD_NOT_FOUND`, без разницы в коде ответа:
раннер не должен уметь отличать «неверный токен» от «сборка уже завершена».

Загрузка `.ipa` читает тело запроса как поток (Express не трогает `application/octet-stream`),
проверяет magic bytes (`PK\x03\x04`) и 300 МБ лимит прямо во время стриминга (не после полной
буферизации) через собственный `Transform` (`ipa-stream.ts`) — превышение лимита или неверная
подпись возвращает `413 FILE_TOO_LARGE`/`400 INVALID_IPA` без сохранения в storage. У каждой попытки
загрузки свой объектный ключ (`buildIpaKey(...) + '-' + uuid`) — если два запроса гонятся за один и
тот же build (повторный вызов раннера, гонка), они никогда не пишут в один и тот же объект; только
ключ победителя попадает в `ipa_key`. Финальное обновление статуса на `done` перечитывает текущий
статус сборки в свежей транзакции прямо перед записью (а не держит одну транзакцию на всё время
долгой загрузки), а сам `UPDATE` требует `status = 'building'` непосредственно в `WHERE` — иначе
Postgres перепроверяет это условие только на старом снапшоте, и проигравший конкурентный вызов мог
бы всё равно перезаписать `ipa_key` победителя. Если гонка проиграна — только что загруженный объект
удаляется и ответ — `409 INVALID_BUILD_STATE`.

Раннер за GitHub Actions шифрует сырой токен AES-256-GCM'ом (`BUILD_TOKEN_KEY`) перед тем, как он
попадёт в `workflow_dispatch`'s input — тот виден в UI/аудит-логе GitHub, поэтому туда уходит только
шифротекст (`buildTokenEnc`); воркфлоу расшифровывает его тем же ключом первым шагом после
`setup-node` и сразу маскирует (`::add-mask::`). `apps/api` отказывается стартовать без
`API_PUBLIC_URL`(`https://`)/`GITHUB_DISPATCH_TOKEN`/`GITHUB_REPO`/`BUILD_TOKEN_KEY`, когда
`BUILD_RUNNER` не `fake` (`validateBuildEnv`, вызывается из `createApp()`) — и наоборот, отказывается
стартовать с `BUILD_RUNNER=fake` при `NODE_ENV=production`.

**Watchdog зависших сборок** (`apps/worker`, раз в 5 минут) — если раннер упал молча (сеть, краш
воркфлоу) и никогда не позвонит в `/fail`, сборка осталась бы в `queued`/`building` навсегда,
занимая единственный активный слот проекта (`builds_one_active_per_project`) без возможности собрать
что-то новое. `public.fail_stuck_builds(batch)` (`0012_builds_watchdog.sql`) — та же схема, что у
`cleanup_expired_drafts`: `SECURITY DEFINER`, владелец `mobilio_migrator`, `EXECUTE` только у
`mobilio_app`. Переводит в `failed`/`error='timeout'` `queued`-сборки старше 30 минут (по
`created_at`) и `building` — старше 60 минут (по `started_at`), пачками по 200
(`apps/worker/src/builds-watchdog.ts`, та же схема батчинга, что у очистки черновиков). Тайм-ауты —
константы в самом
теле функции, не параметры: это осознанное эксплуатационное решение, которое должно проходить через
миграцию, а не меняться тем, что воркер передаст при вызове.

В отличие от `cleanup_expired_drafts` (`DELETE` — у удалённой строки нет «новой версии», которую
нужно перепроверять), эта функция делает `UPDATE`, а Postgres требует, чтобы *результат* `UPDATE`
тоже проходил `USING` политики (не только `WITH CHECK`), заново применённый к новой строке — поэтому
`builds_watchdog`'s `USING` включает `'failed'` наравне с `'queued'`/`'building'`: функция всегда
пишет именно `'failed'`, и новая строка должна остаться в этом же множестве, иначе сам `UPDATE` не
проходит. `'done'` туда никогда не входит — этой политике нельзя видеть/трогать успешно
завершённые сборки.

## Черновики (apps/api/src/drafts, apps/worker)

Бесплатное превью без регистрации: анонимный черновик живёт в отдельной таблице `drafts`
(без `org_id`), доступ к нему — только по claim-токену, не по сессии.

```
POST /drafts                       — { url } → анализ сайта → создание черновика (rate limit по IP)
GET  /drafts/me                    — текущий черновик (по cookie)
PUT  /drafts/me                    — полная замена config
POST /drafts/me/icon               — загрузка иконки (multipart, поле "icon")
GET  /drafts/me/icon               — 302 на подписанную ссылку в object storage
POST /orgs/:orgId/drafts/claim     — переносит черновик в проект организации (после входа)
```

`POST /drafts` не требует входа (`@Public()`) — сырой токен (32 случайных байта, как у
`invitations`) уходит только в httpOnly cookie (`mobilio_draft_token`, `sameSite: lax`,
`secure` по умолчанию — см. `COOKIE_SECURE` ниже, 7 дней), в БД — только его sha256-хеш.
`/drafts/me*` защищены `DraftGuard`: он читает cookie и резолвит черновик по хешу через
`runInTokenLookupContext` — RLS сама отфильтровывает истёкшие черновики (см. ниже), так
что отдельной проверки на expiry в guard'е не нужно.

Rate limit на создание — Redis fixed-window (10 за 10 минут, `INCR` + `EXPIRE ... NX`),
по `request.ip`, не по заголовку напрямую: Express сам решает, доверять ли
`X-Forwarded-For`, через `app.set('trust proxy', TRUST_PROXY_HOPS)` в `create-app.ts`.
`TRUST_PROXY_HOPS=0` (по умолчанию, локально) — заголовок игнорируется целиком, так что
подмена `X-Forwarded-For` не даёт свежий лимит. В проде за Caddy — `TRUST_PROXY_HOPS=1`
(см. `.env.example`). IPv6-клиенты ключуются по префиксу `/64` (провайдер обычно выдаёт
один `/64` на клиента, а конкретный адрес внутри него может меняться от запроса к
запросу) — иначе one IPv6 client получал бы свежий лимит на каждый адрес; IPv4 — по
полному адресу. Если `request.ip` не удалось определить — 400, а не общий ключ.

RLS на `drafts` — тем же паттерном, что у `invitations` (доступ по
`app.lookup_token_hash`), `FOR ALL`, с дополнительным условием `expires_at > now()` (и в
`USING`, и в `WITH CHECK`) — истёкший черновик невидим и неизменяем даже по верному
токену. `FORCE ROW LEVEL SECURITY` остаётся включённым (как на всех RLS-таблицах в этой
схеме, см. выше) — `mobilio_migrator` не получает освобождения владельца от собственных
политик. Вместо этого отдельная политика `drafts_cleanup` (`FOR ALL`, `USING (expires_at
< now())`) выдана `TO mobilio_migrator` — и только ему, не `PUBLIC`, не `mobilio_app`.
Permissive-политики для одной роли ORятся, так что для `mobilio_migrator` это складывается
с `drafts_token_access`; на `mobilio_app` политика вообще не действует.

Фоновая очистка — SQL-функция `public.cleanup_expired_drafts(batch)`, `SECURITY DEFINER`
с владельцем `mobilio_migrator` — выполняется под этой ролью и проходит через
`drafts_cleanup`. Postgres по умолчанию выдаёт `EXECUTE` на новые функции роли `PUBLIC` —
явный `REVOKE EXECUTE ... FROM PUBLIC` перед `GRANT ... TO mobilio_app` закрывает это,
иначе любая роль с доступом к базе могла бы звать функцию напрямую. `SET search_path =
public` защищает от переопределения search_path вызывающей сессией. `apps/worker` раз в
час (`queue.upsertJobScheduler`, идемпотентно переживает перезапуски) вызывает её в цикле
пачками по 500, пока не вернётся меньше 500 строк, и best-effort чистит иконки удалённых
черновиков.

`POST /orgs/:orgId/drafts/claim` (под `OrgGuard`) берёт claim-токен из той же cookie (не
из тела запроса). Ровно один клейм при гонке: первой операцией в транзакции идёт
`DELETE ... WHERE token_hash = $1 AND expires_at > now() RETURNING *` — только тот
конкурентный вызов, чей `DELETE` реально вернул строку, продолжает до `INSERT` в
`projects`; остальные получают 0 строк и 404, даже не добравшись до вставки. Иконка
копируется в `projectIconKey` до открытия транзакции (сначала короткий read-only
pre-read узнаёт id черновика); если иконки черновика нет — используется сгенерированный
буквенный аватар (`generateLetterAvatar`), без 500. Если транзакция клейма проигрывает
гонку или падает — скопированная иконка удаляется, чтобы не остался проект-сирота без
реального клейма. При успехе иконка самого черновика удаляется best-effort (ошибка
логируется, но не валит уже закоммиченный запрос).

И `PUT /drafts/me`, и `PUT /orgs/:orgId/projects/:projectId` всегда перезатирают
серверные поля конфига (`id`, `bundleId`, `trial`) значением из уже сохранённой строки —
тело запроса может прислать что угодно в эти поля, оно будет проигнорировано.

Загрузка иконки (`projects`, `drafts`) ограничена 2 МБ (`FileInterceptor`'s `limits`) —
больше → `413 FILE_TOO_LARGE`.

## Защита от SSRF (apps/api/src/net)

Черновики (Этап 2) и анализ сайта принимают произвольный url от неавторизованного или
только-аутентифицированного пользователя — без защиты это SSRF: сервер можно заставить
обратиться к внутренней сети (`localhost`, Docker-сервисам вроде `minio`, cloud-metadata
`169.254.169.254` и т.п.). `safeFetch` (`apps/api/src/net/safe-fetch.ts`) — единственный
разрешённый способ сходить за пользовательским url; `eslint.config.js` запрещает прямой
вызов `fetch` где-либо ещё в `apps/api/src` (кроме тестов и `resend-mail-sender.ts`, у
которого url фиксированный, не пользовательский).

Правила: только `http`/`https`, только порты 80/443, без логина/пароля в url; хост без
точки (включая `localhost`, docker-имена типа `minio`) отбивается до DNS; все IP, в
которые резолвится хост — не только первый — проверяются против списка запрещённых
диапазонов (`apps/api/src/net/ip-policy.ts`):

- IPv4: loopback (127/8), 10/8, 172.16/12, 192.168/16, 169.254/16 (включая cloud-metadata
  169.254.169.254), 100.64/10 (CGNAT), 0/8, 224/4 и выше (multicast/reserved/broadcast),
  192.0.0/24, 192.0.2/24, 198.18/15, 198.51.100/24, 203.0.113/24 (IETF/TEST-NET/benchmark);
- IPv6: `::1`, весь `::/96` (включая `::` и устаревшую IPv4-совместимую форму — безусловно,
  независимо от того, что в ней зашито), `::ffff:0:0/96` (IPv4-mapped) и `::ffff:0:0:0/96`
  (IPv4-translated — на один блок «глубже», FFFF стоит на группу раньше, реально другой,
  не пересекающийся /96) — оба безусловно, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`,
  `2001::/32` (Teredo), `100::/64` (discard-only). NAT64 (`64:ff9b::/96`), его local-use
  вариант (`64:ff9b:1::/48`, RFC 8215) и 6to4 (`2002::/16`) — вложенный IPv4 извлекается и
  проверяется теми же IPv4-правилами (не бан целиком, не доверие целиком).

Соединение идёт на уже провалидированный адрес через собственный `lookup` в undici
`Agent` — так что даже если DNS поменяет ответ между проверкой и реальным подключением
(rebinding), сокет всё равно откроется на провалидированный адрес. Это проверяется не
только юнит-тестами с подменённым резолвером (`safe-fetch.spec.ts`), но и отдельным
тестом с настоящими сокетами (`safe-fetch.binding.spec.ts`): резолвер первый раз отдаёт
адрес тестового сервера, при гипотетическом повторном вызове — другой («чужой») адрес;
если `dispatcher` игнорируется и соединение само себя резолвит заново, тест падает.
Редиректы — вручную (`redirect: 'manual'`), не больше 5, каждый новый адрес проходит ту
же проверку, тело промежуточного ответа отменяется (`response.body?.cancel()`) перед
следующим шагом. Общий таймаут, лимит размера тела с реальной остановкой чтения потока
(не просто проверка `Content-Length`), проверка `Content-Type`. У `sharp` — явный
`limitInputPixels` на иконках (decompression-bomb).

Ошибки — стабильные коды (`UNSAFE_URL`, `SITE_UNREACHABLE`, `NOT_HTML`,
`SITE_ERROR_STATUS`, `RESPONSE_TOO_LARGE`, `TOO_MANY_REDIRECTS`), не русский текст в
`message` — `apps/web` со временем переводит по коду, не парсит текст ошибки.

## Структура репозитория

```
apps/shell/   — Expo-оболочка (SDK 57, expo-router)
apps/web/     — Next.js App Router: сайт, анализ сайтов, API сборки, вход/выход, шапка
apps/api/     — NestJS: auth (Better Auth), организации, проекты, черновики, сборки (builds),
                health-check, очередь (BullMQ)
apps/worker/  — BullMQ-воркер — каркас для следующих этапов
packages/config/   — общая zod-схема конфига + утилиты (slug, bundleId, иконки)
packages/db/       — Drizzle-схема, миграции, роли/RLS, TenantContext (см. выше)
packages/storage/  — ObjectStorage-интерфейс + S3/MinIO-адаптер (см. выше)
packages/repacker/ — пусто, заготовка под будущую логику репака
data/projects/   — файловое хранилище проектов apps/web (в .gitignore; уходит в Этапе 2)
docker-compose.yml — Postgres, Redis, MinIO, migrate/createbucket (роли+миграции+бакет), api, worker
.github/workflows/build-ipa.yml — сборка .ipa в GitHub Actions
.github/workflows/ci.yml        — lint/typecheck/test на push+PR; Playwright E2E (создание .ipa +
                                   полный auth-флоу через реальный api) на PR в main
```
