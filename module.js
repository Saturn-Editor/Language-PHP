import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
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

  saturn.languages.registerDocComment('php', (ctx) => docComment(ctx.text, ctx.line));

  saturn.languages.onDidRenameSymbol(async (event) => {
    if (event.languageId !== 'php' || basename(event.path) !== `${event.oldName}.php`) return;
    const file = isAbsolute(event.path) ? event.path : join(event.projectPath, event.path);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return;
    }
    const types = [...stripPhpNoise(text).matchAll(/^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)/gm)];
    if (types.length !== 1 || types[0][2] !== event.newName) return;
    try {
      await saturn.workspace.renameFile(event.projectPath, event.path, `${event.newName}.php`);
    } catch (error) {
      saturn.window.showMessage(`Could not rename ${basename(event.path)}: ${error.message}`, { kind: 'error', projectPath: event.projectPath });
    }
  });

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

function stripPhpNoise(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(?:\/\/|#(?!\[)).*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
}

function docComment(text, line) {
  const lines = text.split(/\r?\n/);
  let i = line + 1;
  while (i < lines.length && (/^\s*$/.test(lines[i]) || /^\s*#\[/.test(lines[i]))) i++;
  if (i >= lines.length) return null;
  const header = lines.slice(i, i + 20).join('\n').replace(/#\[[^\]]*\]/g, '').trim();

  if (/^(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\b/.test(header)) {
    return '/**\n * $1\n */';
  }

  const fn = header.match(/^(?:(?:public|protected|private|static|abstract|final)\s+)*function\s*&?\s*([A-Za-z_]\w*)\s*\(/);
  if (fn) {
    const open = fn[0].length - 1;
    const close = matchingParen(header, open);
    if (close < 0) return null;
    const tags = splitTopLevel(header.slice(open + 1, close)).map(paramTag).filter(Boolean);
    const returnType = header.slice(close + 1).match(/^\s*:\s*([^{;]+?)\s*(?:[{;]|$)/)?.[1];
    if (fn[1].toLowerCase() !== '__construct') tags.push(`@return ${returnType ?? 'mixed'}`);
    return ['/**', ' * $1', ...(tags.length ? [' *', ...tags.map((t) => ` * ${t}`)] : []), ' */'].join('\n');
  }

  const prop = header.match(/^(?:(?:public|protected|private|static|readonly|var)\s+)+(?:([?\w\\|&()]+)\s+)?\$\w+/);
  if (prop) {
    return prop[1] ? `/**\n * $1\n *\n * @var ${prop[1]}\n */` : '/**\n * $1\n */';
  }
  return null;
}

function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function paramTag(param) {
  const m = param
    .replace(/^(?:(?:public|protected|private|readonly)\s+)+/, '')
    .match(/^(?:([?\w\\|&()]+)\s+)?&?\s*(\.\.\.)?\s*\$(\w+)/);
  if (!m) return null;
  return `@param ${m[1] ?? 'mixed'} ${m[2] ?? ''}\\$${m[3]}`;
}

function quote(path) {
  return `"${path.replaceAll('"', '\\"')}"`;
}
