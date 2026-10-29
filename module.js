import { basename } from 'node:path';
import { installPhpactor } from './server/phpactor.js';
import { listPhpVersions, phpInFolder, saveChoice } from './server/versions.js';

export function activate(saturn) {
  saturn.languages.registerVersions('php', {
    list: () => listPhpVersions(),
    addLabel: 'Add PHP…',
    add: async ({ folder }) => {
      const version = await phpInFolder(folder);
      if (!version) throw new Error(`No PHP executable found in ${folder} or ${folder}/bin.`);
      return version;
    },
    onChange: async ({ projectPath, version }) => {
      await saveChoice(saturn.storagePath, projectPath, version?.id);
      await saturn.languageServer.restart();
    },
  });

  saturn.commands.register('php.installServer', async (ctx) => {
    saturn.window.showMessage('Downloading Phpactor...', { projectPath: ctx?.projectPath });
    try {
      await installPhpactor(saturn.storagePath);
      await saturn.languageServer.restart();
      saturn.window.showMessage('Phpactor installed.', { projectPath: ctx?.projectPath });
    } catch (error) {
      saturn.window.showMessage(`Phpactor install failed: ${error.message}`, { kind: 'error', projectPath: ctx?.projectPath });
    }
  });

  saturn.commands.register('php.composerInstall', (ctx) => {
    saturn.terminal.run(ctx.projectPath, { name: 'composer install', command: 'composer install' });
  });

  saturn.files.registerTemplate('php.file', {
    fileName: phpFileName,
    content: () => '<?php\n\ndeclare(strict_types=1);\n\n',
  });

  for (const kind of ['class', 'interface', 'trait', 'enum']) {
    saturn.files.registerTemplate(`php.${kind}`, {
      fileName: phpFileName,
      content: (ctx) => `<?php\n\ndeclare(strict_types=1);\n\n${kind} ${typeName(ctx)}\n{\n}\n`,
    });
  }

  saturn.run.registerProvider(async (ctx) => {
    const entries = [];
    const chosen = await saturn.languages.getVersion(ctx.projectPath, 'php');
    const php = chosen ? quote(chosen.id) : 'php';
    const file = saturn.editor.activeFile(ctx.projectPath)?.path;
    if (file?.toLowerCase().endsWith('.php')) {
      entries.push({ name: `php ${basename(file)}`, command: `${php} ${quote(file)}` });
    }
    if ((await saturn.workspace.findFiles(ctx.projectPath, 'public/index.php')).length) {
      entries.push({ name: 'PHP built-in server (public/)', command: `${php} -S localhost:8000 -t public` });
    } else {
      entries.push({ name: 'PHP built-in server', command: `${php} -S localhost:8000` });
    }
    if ((await saturn.workspace.findFiles(ctx.projectPath, 'vendor/bin/phpunit')).length) {
      entries.push({ name: 'PHPUnit', command: 'vendor/bin/phpunit' });
    }
    return entries;
  });
}

export function deactivate() {}

// ctx.name is what the user typed, with or without the extension.
function phpFileName(ctx) {
  return `${ctx.name.replace(/\.php$/i, '')}.php`;
}

function typeName(ctx) {
  const name = basename(ctx?.name ?? 'MyClass').replace(/\.php$/i, '');
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : 'MyClass';
}

function quote(path) {
  return `"${path.replaceAll('"', '\\"')}"`;
}
