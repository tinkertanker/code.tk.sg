/* global module, window */

// Automatic language detection for pastes.
//
// highlight.js scores every grammar by how many keywords and patterns match,
// which goes wrong for short pastes: a few lines of Swift look like Rust,
// Dart, SCSS or VBScript. This module narrows automatic detection to the
// languages people commonly paste and adds points for syntax that is
// distinctive to one language. Every bundled language can still be chosen
// explicitly with a URL extension such as /key.swift.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  }
  else {
    root.hasteLanguageDetect = factory();
  }
})(typeof window !== 'undefined' ? window : this, function() {

  // Candidates for automatic detection. Earlier entries win ties.
  var AUTO_LANGUAGES = [
    'python', 'javascript', 'typescript', 'swift', 'java', 'c', 'cpp',
    'csharp', 'go', 'rust', 'kotlin', 'dart', 'php', 'ruby', 'xml', 'css',
    'json', 'yaml', 'markdown', 'bash', 'shell', 'sql', 'lua', 'r', 'perl',
    'objectivec', 'diff', 'ini', 'makefile', 'dockerfile', 'elixir',
    'powershell', 'latex'
  ];

  var JS_HINTS = [
    [/\bconsole\.(log|error|warn)\(/, 5],
    [/\b(const|let)\s+\w+\s*=.*;\s*$/m, 2],
    [/=>/, 2],
    [/\bfunction\s*\w*\s*\(/, 3],
    [/\b(document|window)\.\w+|\baddEventListener\(/, 4],
    [/\brequire\(['"]|\bmodule\.exports\b|\bexport\s+(default|const|function|async)\b/, 3],
    [/===|!==/, 3],
    [/^\s*import\s+.+\s+from\s+['"]/m, 3],
    [/\bawait\s+fetch\(/, 3]
  ];

  // [pattern, points]: each pattern that matches adds its points once.
  var HINTS = {
    swift: [
      [/^\s*import\s+(SwiftUI|UIKit|Foundation|Combine|AppKit|SwiftData|PlaygroundSupport)\s*$/m, 10],
      [/"[^"\n]*\\\([^)\n]*\)[^"\n]*"/, 6],
      [/\bfunc\s+\w+\s*(<[^>]*>)?\([^)]*\)\s*(async\s+)?(throws\s+)?->/, 4],
      [/\bfunc\s+\w+\s*\((_\s+)?\w+\s*:\s*[A-Z[(]/, 4],
      [/\b(guard|if|while)\s+(let|var)\s+\w+/, 6],
      [/\b(let|var)\s+\w+\s*:\s*[A-Z[(]/, 3],
      [/\bsome\s+View\b|@(State|Binding|Published|ObservedObject|StateObject|Environment)\b/, 8],
      [/\w\s*(\.\.\.|\.\.<)\s*\w/, 5],
      [/\bstruct\s+\w+\s*:\s*[A-Z]/, 5],
      [/\binit\s*\(/, 3],
      [/\$0\b/, 4],
      [/\bcase\s+\.\w+|\.allCases\b|\.rawValue\b/, 4],
      [/\{\s*\(?\w+(\s*,\s*\w+)*\)?\s+in\b/, 5],
      [/^\s*for\s+\(?\w+(\s*,\s*\w+\))?\s+in\s+[^:]+\{\s*$/m, 3],
      [/\b(moveForward|turnLeft|turnRight|collectGem|toggleSwitch|isBlocked|isOnGem)\b/, 8],
      [/\w\?\?|\?\?\s/, 2],
      [/\btry\s+await\b|\basync\s+throws\b/, 4],
      [/^\s*(let|var)\s+\w+\s*(:\s*[^=\n]+)?=\s*[^;\n]*$/m, 2],
      [/;\s*$/m, -3]
    ],
    rust: [
      [/\bfn\s+\w+\s*(<[^>]*>)?\s*\(/, 6],
      [/\b\w+!\(/, 5],
      [/\blet\s+mut\b/, 6],
      [/\bimpl\b|\bpub\s+(fn|struct|enum|mod|trait)\b|#\[derive/, 5],
      [/&(mut\s+)?(str|self)\b|\b[iu](8|16|32|64|128|size)\b/, 4],
      [/\bmatch\s+[^{\n]+\{/, 4],
      [/\b(Result|Option|Vec|Box)<|\b(Ok|Some|Err)\(/, 3],
      [/\buse\s+(std|crate|super)::/, 6]
    ],
    go: [
      [/^\s*package\s+\w+\s*$/m, 10],
      [/:=/, 5],
      [/\bfmt\.\w+/, 6],
      [/\bfunc\s+\(\w+\s+\*?\w+\)/, 6],
      [/\bfunc\s+\w+\(\w+\s+(\[\])?\*?[a-z]\w*/, 4],
      [/\btype\s+\w+\s+(struct|interface)\b/, 6]
    ],
    kotlin: [
      [/\bfun\s+\w+\s*\(/, 6],
      [/\bval\s+\w+/, 4],
      [/\bdata\s+class\b/, 5]
    ],
    python: [
      [/^\s*def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/m, 6],
      [/^\s*(if|elif|else|for|while|try|except|with|class)\b.*:\s*$/m, 4],
      [/^\s*(from\s+[\w.]+\s+)?import\s+[\w.]+(\s+as\s+\w+)?\s*$/m, 2],
      [/\b(True|False|None)\b/, 3],
      [/\b(input|range|len)\(/, 3],
      [/\bf["'][^"'\n]*\{/, 3],
      [/\[[^\]\n]+\bfor\s+\w+\s+in\s+[^\]\n]+\]/, 5],
      [/^\s*from\s+microbit\s+import\b/m, 8],
      [/^#!.*\bpython/, 10]
    ],
    javascript: JS_HINTS.concat([
      [/^#!.*\bnode\b/, 10]
    ]),
    typescript: JS_HINTS.concat([
      [/\binterface\s+\w+\s*\{/, 5],
      [/\w\s*\??:\s*(string|number|boolean|any|unknown|void|never)\b/, 6],
      [/\btype\s+\w+\s*=/, 4],
      [/\bPromise</, 2],
      [/\b(let|const)\s+\w+\s*:\s*\w+(<[^>]*>)?(\[\])?\s*=[^;\n]*;/, 3]
    ]),
    java: [
      [/\bpublic\s+static\s+void\s+main\b/, 8],
      [/\bSystem\.out\.print/, 8],
      [/\bnew\s+\w+<>/, 4],
      [/^\s*import\s+java\./m, 8],
      [/@Override\b/, 4],
      [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[A-Z]\w*(<[^>]*>)?\s+\w+\s*\(/, 3]
    ],
    csharp: [
      [/^\s*using\s+[A-Z][\w.]*;/m, 6],
      [/\bConsole\.Write/, 8],
      [/\bMonoBehaviour\b|\bVector3\b/, 6]
    ],
    c: [
      [/#include\s*<(stdio|stdlib|string|math|stdbool|stdint)\.h>/, 6],
      [/\bprintf\(/, 3],
      [/\b(malloc|free|scanf)\(/, 3],
      [/\b(int|char|float|double|long|void)\s*\*\s*\w+/, 4]
    ],
    cpp: [
      [/#include\s*<(iostream|vector|string|map|algorithm|memory)>/, 6],
      [/\bstd::|\bcout\s*<<|\busing\s+namespace\b/, 6]
    ],
    dart: [
      [/^\s*import\s+'(package|dart):/m, 10],
      [/\bvoid\s+main\s*\(\s*\)\s*\{/, 4],
      [/\b(Widget|BuildContext|StatelessWidget|StatefulWidget)\b/, 8],
      [/\bfinal\s+[\w<>?]+(\s+\w+)?\s*[=;]/, 2],
      [/\(\s*this\.\w+\s*[,)]/, 5]
    ],
    ruby: [
      [/^\s*puts\s/m, 5],
      [/\bdo\s*\|\w+(\s*,\s*\w+)*\|/, 6],
      [/^\s*def\s+\w+[^:\n]*$/m, 2],
      [/^\s*end\s*$/m, 2]
    ],
    elixir: [
      [/\bdefmodule\b/, 10],
      [/\|>/, 4],
      [/\bIO\.(puts|inspect)\b/, 6],
      [/\bfn\s+\w+(\s*,\s*\w+)*\s*->/, 5]
    ],
    php: [
      [/<\?php/, 10]
    ],
    sql: [
      [/\bSELECT\b[\s\S]+\bFROM\b|\bINSERT\s+INTO\b|\bCREATE\s+TABLE\b|\bDELETE\s+FROM\b/i, 5]
    ],
    dockerfile: [
      [/^\s*FROM\s+[\w./:@-]+(\s+AS\s+\w+)?\s*$/im, 8],
      [/^(RUN|COPY|WORKDIR|EXPOSE|CMD|ENTRYPOINT|ENV|ARG)\s/m, 3]
    ],
    powershell: [
      [/\b(Get|Set|New|Remove|Write|Read|Where|ForEach|Select|Invoke)-[A-Z]\w+\b/, 6],
      [/\$_\b/, 3]
    ],
    bash: [
      [/^#!.*\b(ba|z)?sh\b/, 10],
      [/^\s*(fi|done|esac)\s*$/m, 3],
      [/\[\[?\s+-[a-z]\s/, 4],
      [/^\s*echo\s/m, 2]
    ]
  };

  function hintScore(language, code) {
    var hints = HINTS[language] || [];
    var score = 0;
    for (var i = 0; i < hints.length; i++) {
      if (hints[i][0].test(code)) score += hints[i][1];
    }
    return score;
  }

  // Like hljs.highlightAuto, but limited to AUTO_LANGUAGES and adjusted by
  // HINTS. Returns { language, value, relevance }; language is undefined when
  // nothing scores above zero, matching highlight.js's plain text result.
  function highlightAuto(hljs, code) {
    var best = null;
    for (var i = 0; i < AUTO_LANGUAGES.length; i++) {
      var language = AUTO_LANGUAGES[i];
      if (!hljs.getLanguage(language)) continue;
      var result = hljs.highlight(code, { language: language });
      var score = (result.illegal ? 0 : result.relevance) + hintScore(language, code);
      if (score > 0 && (!best || score > best.relevance)) {
        best = { language: language, value: result.value, relevance: score };
      }
    }
    if (!best) {
      var plain = hljs.highlight(code, { language: 'plaintext' });
      return { language: undefined, value: plain.value, relevance: 0 };
    }
    return best;
  }

  return {
    AUTO_LANGUAGES: AUTO_LANGUAGES,
    hintScore: hintScore,
    highlightAuto: highlightAuto
  };
});
