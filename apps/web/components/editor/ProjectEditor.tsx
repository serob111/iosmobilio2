"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProjectConfig } from "@mobilio/config";
import { SUPPORTED_ICONS, type SupportedIcon } from "@mobilio/config";
import type { Tab as EditorTab } from "@/lib/apiClient";
import { useApiErrorMessage } from "@/lib/errorCodes";
import { PreviewShell } from "@/components/preview/PreviewShell";
import type { PreviewDto } from "@/lib/apiClient";
import type { ProjectEditorAdapter } from "./types";
import { BuildsBlock } from "./BuildsBlock";

type Props = {
  adapter: ProjectEditorAdapter;
};

function configToPreviewDto(config: ProjectConfig, iconUrl: string, proxyBase: string): PreviewDto {
  return {
    name: config.name,
    theme: config.theme,
    statusBar: config.theme.statusBar,
    tabs: config.tabs,
    iconUrl,
    proxyBase,
  };
}

export function ProjectEditor({ adapter }: Props) {
  const t = useTranslations("editor");
  const apiErrorMessage = useApiErrorMessage();

  const [config, setConfig] = useState<ProjectConfig>(adapter.initialConfig);
  const [savedConfig, setSavedConfig] = useState<ProjectConfig>(adapter.initialConfig);
  const [iconVersion, setIconVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const previewDto = useMemo(
    () => configToPreviewDto(savedConfig, adapter.iconUrl(iconVersion), adapter.proxyBase),
    [savedConfig, adapter, iconVersion],
  );

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const saved = await adapter.save(config);
      setConfig(saved);
      setSavedConfig(saved);
      setSaveMessage(t("saved"));
    } catch (error) {
      setSaveError(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleIconUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingIcon(true);
    setSaveError(null);
    try {
      await adapter.uploadIcon(file);
      setIconVersion(Date.now());
    } catch (error) {
      setSaveError(apiErrorMessage(error));
    } finally {
      setUploadingIcon(false);
      event.target.value = "";
    }
  }

  function updateTabs(tabs: EditorTab[]) {
    setConfig((c) => ({ ...c, tabs }));
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 lg:flex-row lg:items-start lg:justify-center">
      <div className="w-full max-w-xl space-y-8">
        <section className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- remote signed URL, not a static asset */}
          <img
            src={adapter.iconUrl(iconVersion)}
            alt=""
            crossOrigin="use-credentials"
            className="h-16 w-16 rounded-xl border border-zinc-200 object-cover"
          />
          <label className="cursor-pointer rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            {uploadingIcon ? t("uploadingIcon") : t("replaceIcon")}
            <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploadingIcon} onChange={handleIconUpload} />
          </label>
        </section>

        <section>
          <label className="block text-sm font-medium text-zinc-700">{t("nameLabel")}</label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
            maxLength={50}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </section>

        <ThemeEditor config={config} onChange={(theme) => setConfig((c) => ({ ...c, theme }))} />

        <TabsEditor tabs={config.tabs} onChange={updateTabs} />

        <FeaturesEditor config={config} onChange={(features) => setConfig((c) => ({ ...c, features }))} />

        <section className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-[#4B2BE0] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#3d22b8] disabled:opacity-50"
          >
            {saving ? t("saving") : t("save")}
          </button>
          {saveMessage ? <span className="text-sm text-green-600">{saveMessage}</span> : null}
          {saveError ? <span className="text-sm text-red-600">{saveError}</span> : null}
        </section>

        {adapter.builds ? <BuildsBlock builds={adapter.builds} /> : null}
      </div>

      <div className="flex w-full justify-center lg:w-auto">
        <PreviewShell dto={previewDto} />
      </div>
    </div>
  );
}

function ThemeEditor({ config, onChange }: { config: ProjectConfig; onChange: (theme: ProjectConfig["theme"]) => void }) {
  const t = useTranslations("editor");
  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-900">{t("themeSection")}</h2>
      <div className="mt-3 flex flex-wrap gap-6">
        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          {t("primaryColor")}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.theme.primary}
              onChange={(e) => onChange({ ...config.theme, primary: e.target.value })}
              className="h-9 w-9 cursor-pointer rounded border border-zinc-300"
            />
            <input
              type="text"
              value={config.theme.primary}
              onChange={(e) => onChange({ ...config.theme, primary: e.target.value })}
              className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          {t("backgroundColor")}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.theme.background}
              onChange={(e) => onChange({ ...config.theme, background: e.target.value })}
              className="h-9 w-9 cursor-pointer rounded border border-zinc-300"
            />
            <input
              type="text"
              value={config.theme.background}
              onChange={(e) => onChange({ ...config.theme, background: e.target.value })}
              className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-700">
          {t("statusBarLabel")}
          <select
            value={config.theme.statusBar}
            onChange={(e) => onChange({ ...config.theme, statusBar: e.target.value as "dark" | "light" })}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="dark">{t("statusBarDark")}</option>
            <option value="light">{t("statusBarLight")}</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function TabsEditor({ tabs, onChange }: { tabs: EditorTab[]; onChange: (tabs: EditorTab[]) => void }) {
  const t = useTranslations("editor");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function updateTab(index: number, patch: Partial<EditorTab>) {
    onChange(tabs.map((tab, i) => (i === index ? { ...tab, ...patch } : tab)));
  }

  function removeTab(index: number) {
    onChange(tabs.filter((_, i) => i !== index));
  }

  function moveTab(from: number, to: number) {
    if (to < 0 || to >= tabs.length) return;
    const next = tabs.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  }

  function addTab() {
    onChange([...tabs, { title: "", icon: "home", path: "/" }]);
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-900">{t("tabsSection")}</h2>
      <ul className="mt-3 space-y-2">
        {tabs.map((tab, index) => (
          <li
            key={index}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) moveTab(dragIndex, index);
              setDragIndex(null);
            }}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2"
          >
            <span className="cursor-grab select-none text-zinc-400" aria-hidden="true">
              ⠿
            </span>
            <input
              type="text"
              aria-label={t("tabTitleLabel")}
              placeholder={t("tabTitleLabel")}
              value={tab.title}
              onChange={(e) => updateTab(index, { title: e.target.value })}
              className="w-28 rounded border border-zinc-300 px-2 py-1 text-sm"
            />
            {tab.native ? (
              <span className="flex-1 text-sm text-zinc-500">{t("tabNativeContacts")}</span>
            ) : (
              <input
                type="text"
                aria-label={t("tabPathLabel")}
                placeholder={t("tabPathLabel")}
                value={tab.path ?? ""}
                onChange={(e) => updateTab(index, { path: e.target.value })}
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
            )}
            <select
              aria-label={t("tabIconLabel")}
              value={tab.icon}
              onChange={(e) => updateTab(index, { icon: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-1 text-sm"
            >
              {SUPPORTED_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {t(`icons.${icon}` as `icons.${SupportedIcon}`)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => moveTab(index, index - 1)} disabled={index === 0} className="text-zinc-400 disabled:opacity-30">
              ↑<span className="sr-only">{t("moveTabUp")}</span>
            </button>
            <button
              type="button"
              onClick={() => moveTab(index, index + 1)}
              disabled={index === tabs.length - 1}
              className="text-zinc-400 disabled:opacity-30"
            >
              ↓<span className="sr-only">{t("moveTabDown")}</span>
            </button>
            <button type="button" onClick={() => removeTab(index)} disabled={tabs.length <= 1} className="text-red-500 disabled:opacity-30">
              ✕<span className="sr-only">{t("removeTab")}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addTab}
        disabled={tabs.length >= 5}
        className="mt-2 text-sm font-medium text-[#4B2BE0] disabled:opacity-40"
      >
        {t("addTab")}
      </button>
    </section>
  );
}

function FeaturesEditor({
  config,
  onChange,
}: {
  config: ProjectConfig;
  onChange: (features: ProjectConfig["features"]) => void;
}) {
  const t = useTranslations("editor");
  const features = config.features;
  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-900">{t("featuresSection")}</h2>
      <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={features.offline} onChange={(e) => onChange({ ...features, offline: e.target.checked })} />
          {t("featureOffline")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={features.share} onChange={(e) => onChange({ ...features, share: e.target.checked })} />
          {t("featureShare")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={features.deepLinks} onChange={(e) => onChange({ ...features, deepLinks: e.target.checked })} />
          {t("featureDeepLinks")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={features.pullToRefresh}
            onChange={(e) => onChange({ ...features, pullToRefresh: e.target.checked })}
          />
          {t("featurePullToRefresh")}
        </label>
      </div>
    </section>
  );
}
