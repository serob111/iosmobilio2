"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SUPPORTED_ICONS, type ProjectConfig } from "@mobilio/config";

const ICON_LABELS: Record<string, string> = {
  home: "Главная",
  grid: "Каталог",
  location: "Контакты",
  cart: "Корзина",
  person: "Профиль",
  search: "Поиск",
  heart: "Избранное",
  info: "Инфо",
  chat: "Чат",
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-zinc-600">
      {children}
    </div>
  );
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [iconVersion, setIconVersion] = useState(0);
  const [iconError, setIconError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить проект");
        if (!cancelled) setConfig(data as ProjectConfig);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить");
      setConfig(data as ProjectConfig);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleIconUpload(file: File) {
    setIconError(null);
    const formData = new FormData();
    formData.append("icon", file);
    try {
      const res = await fetch(`/api/projects/${id}/icon`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить иконку");
      setIconVersion((v) => v + 1);
    } catch (e) {
      setIconError(e instanceof Error ? e.message : "Ошибка загрузки иконки");
    }
  }

  function updateTab(index: number, patch: Partial<ProjectConfig["tabs"][number]>) {
    if (!config) return;
    const tabs = config.tabs.map((tab, i) => (i === index ? { ...tab, ...patch } : tab));
    setConfig({ ...config, tabs });
  }

  function addTab() {
    if (!config || config.tabs.length >= 5) return;
    setConfig({
      ...config,
      tabs: [...config.tabs, { title: "Новая вкладка", icon: "grid", path: "/" }],
    });
  }

  function removeTab(index: number) {
    if (!config || config.tabs.length <= 1) return;
    setConfig({ ...config, tabs: config.tabs.filter((_, i) => i !== index) });
  }

  if (loading) return <Centered>Загрузка…</Centered>;
  if (loadError || !config) return <Centered>{loadError ?? "Проект не найден"}</Centered>;

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <div className="flex items-center gap-4">
        <img
          src={`/api/projects/${id}/icon?v=${iconVersion}`}
          alt="Иконка приложения"
          className="h-16 w-16 rounded-2xl border border-zinc-200 object-cover"
        />
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{config.name}</h1>
          <label className="mt-1 inline-block cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-700">
            Заменить иконку
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleIconUpload(file);
                e.target.value = "";
              }}
            />
          </label>
          {iconError ? <p className="text-sm text-red-600">{iconError}</p> : null}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-zinc-200 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700">Название приложения</span>
          <input
            type="text"
            value={config.name}
            onChange={(e) => setConfig({ ...config, name: e.target.value })}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700">Основной цвет</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.theme.primary}
              onChange={(e) =>
                setConfig({ ...config, theme: { ...config.theme, primary: e.target.value.toUpperCase() } })
              }
              className="h-9 w-9 cursor-pointer rounded border border-zinc-300"
            />
            <input
              type="text"
              value={config.theme.primary}
              onChange={(e) =>
                setConfig({ ...config, theme: { ...config.theme, primary: e.target.value } })
              }
              className="w-32 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">Вкладки</span>
            {config.tabs.length < 5 ? (
              <button
                type="button"
                onClick={addTab}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                + Добавить вкладку
              </button>
            ) : null}
          </div>

          {config.tabs.map((tab, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={tab.title}
                onChange={(e) => updateTab(index, { title: e.target.value })}
                placeholder="Название"
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              {tab.native ? (
                <span className="w-32 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
                  Контакты
                </span>
              ) : (
                <input
                  type="text"
                  value={tab.path ?? ""}
                  onChange={(e) => updateTab(index, { path: e.target.value })}
                  placeholder="/path"
                  className="w-32 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              )}
              <select
                value={tab.icon}
                onChange={(e) => updateTab(index, { icon: e.target.value })}
                className="rounded-lg border border-zinc-300 px-2 py-2 text-sm outline-none focus:border-blue-500"
              >
                {SUPPORTED_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {ICON_LABELS[icon] ?? icon}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeTab(index)}
                disabled={config.tabs.length <= 1}
                className="px-2 text-zinc-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Удалить вкладку"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
          {saved ? <span className="text-sm text-green-600">Сохранено</span> : null}
          {saveError ? <span className="text-sm text-red-600">{saveError}</span> : null}
        </div>
      </div>
    </div>
  );
}
