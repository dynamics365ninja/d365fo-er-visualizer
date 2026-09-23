import { getElectronApi } from '../fno/electron-bridge';
import { t } from '../i18n';

/**
 * `false` means the file parsed but was not loaded (a newer version of the
 * same configuration is already open — the store says so in a toast).
 */
type LoadXmlFile = (xml: string, filePath: string) => boolean | void;

export type FileLoadResult = {
  loaded: number;
  errors: string[];
};

async function ingestXmlFiles(
  files: Array<{ name: string; content: string }>,
  loadXmlFile: LoadXmlFile,
): Promise<FileLoadResult> {
  const errors: string[] = [];
  let loaded = 0;

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      errors.push(`${file.name} – ${t.fileNotXml}`);
      continue;
    }

    try {
      if (loadXmlFile(file.content, file.name) !== false) loaded++;
    } catch (error) {
      // The store has shown this one in a toast already.
      if ((error as { reported?: boolean } | null)?.reported) continue;
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file.name}: ${message}`);
    }
  }

  return { loaded, errors };
}

export async function loadBrowserFiles(
  files: FileList | null,
  loadXmlFile: LoadXmlFile,
): Promise<FileLoadResult> {
  if (!files || files.length === 0) {
    return { loaded: 0, errors: [] };
  }

  const fileEntries = await Promise.all(
    Array.from(files).map(async file => ({
      name: file.name,
      content: await file.text(),
    })),
  );

  return ingestXmlFiles(fileEntries, loadXmlFile);
}

export async function openFilesWithSystemDialog(
  loadXmlFile: LoadXmlFile,
): Promise<FileLoadResult | null> {
  const electronApi = getElectronApi();
  if (!electronApi) return null;

  const files = await electronApi.openFileDialog();
  if (!files || files.length === 0) {
    return { loaded: 0, errors: [] };
  }

  return ingestXmlFiles(
    files.map(file => ({
      name: file.path.split(/[\\/]/).pop() ?? file.path,
      content: file.content,
    })),
    loadXmlFile,
  );
}