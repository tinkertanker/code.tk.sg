/* global window */

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
    'powershell', 'latex', 'arduino'
  ];

  // Grammars that claim too much ordinary code by keywords alone. They are
  // only considered when one of their hints matches.
  var NEEDS_HINT = ['dart', 'elixir', 'powershell', 'dockerfile', 'ini', 'latex', 'arduino'];

  // Detection only looks at the start of a paste. This bounds the cost of the
  // per-language passes and the hint patterns on very large pastes.
  var SAMPLE_LENGTH = 10000;

  // Hint patterns must stay linear: keep character classes on one line
  // ([^x\n], [ \t]) and bound repeats, because a paste can be 400 KB.
  var JS_HINTS = [
    [/\bconsole\.(log|error|warn)\(/, 5],
    [/\b(const|let)\s+\w+\s*=[^\n]*;[ \t]*$/m, 2],
    [/=>/, 2],
    [/\bfunction\s*\w*\s*\([^)\n]*\)\s*\{/, 3],
    [/\b(document|window)\.\w+|\baddEventListener\(/, 4],
    [/\brequire\(['"]|\bmodule\.exports\b|\bexport\s+(default|const|function|async)\b/, 3],
    [/===|!==/, 3],
    [/^[ \t]*import\s[^\n]+\sfrom\s+['"]/m, 3],
    [/\bawait\s+fetch\(/, 3]
  ];

  // [pattern, points]: each pattern that matches adds its points once.
  var HINTS = {
    swift: [
      [/^[ \t]*import\s+(SwiftUI|UIKit|Foundation|Combine|AppKit|SwiftData|PlaygroundSupport)[ \t]*$/m, 10],
      [/"[^"\n]*\\\([^)\n]*\)[^"\n]*"/, 6],
      [/\bfunc\s+\w+\s*(<[^>\n]*>)?\([^)\n]*\)\s*(async\s+)?(throws\s+)?->/, 4],
      [/\bfunc\s+\w+\s*\((_\s+)?\w+\s*:\s*[A-Z[(]/, 4],
      [/\b(guard|if|while)\s+(let|var)\s+\w+\s*=/, 6],
      [/\b(let|var)\s+\w+\s*:\s*[A-Z[(]/, 3],
      [/\bsome\s+View\b|@(State|Binding|Published|ObservedObject|StateObject|Environment)\b/, 8],
      [/\b\w+(\.\.\.|\.\.<)\w/, 5],
      [/\bstruct\s+\w+\s*:\s*[A-Z]/, 5],
      [/\binit\s*\(/, 3],
      [/\{[^}\n]*\$0\b/, 4],
      [/\bcase\s+\.\w+|\.allCases\b|\.rawValue\b/, 4],
      [/\{\s*\(?\w+(\s*,\s*\w+)*\)?\s+in\b/, 5],
      [/^[ \t]*for\s+\(?\w+(\s*,\s*\w+\))?\s+in\s+[^:;\n]+\{[ \t]*$/m, 3],
      [/\b(moveForward|turnLeft|turnRight|collectGem|toggleSwitch|isBlocked|isOnGem)\b/, 8],
      [/\w\?\?|\?\?\s/, 2],
      [/\btry\s+await\b|\basync\s+throws\b/, 4],
      [/^[ \t]*(let|var)\s+\w+[ \t]*(:[^=\n]+)?=[^;\n]*$/m, 2],
      [/;[ \t]*$/m, -3]
    ],
    rust: [
      [/\bfn\s+\w+\s*(<[^>\n]*>)?\s*\(/, 6],
      [/\b\w+!\(/, 5],
      [/\blet\s+mut\b/, 6],
      [/\bimpl\b|\bpub\s+(fn|struct|enum|mod|trait)\b|#\[derive/, 5],
      [/&(mut\s+)?(str|self)\b|\b[iu](8|16|32|64|128|size)\b/, 4],
      [/\bmatch\s+[^{\n]+\{/, 4],
      [/\b(Result|Option|Vec|Box)<|\b(Ok|Some|Err)\(/, 3],
      [/\buse\s+(std|crate|super)::/, 6]
    ],
    go: [
      [/^package\s+\w+[ \t]*$/m, 10],
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
      [/^[ \t]*def\s+\w+\s*\([^\n]*\)[ \t]*(->[^:\n]+)?:[ \t]*$/m, 6],
      [/^[ \t]*(if|elif|else|for|while|try|except|with|class)\b[^\n]*:[ \t]*$/m, 4],
      [/^(from\s+[\w.]+\s+)?import\s+[\w.]+(\s+as\s+\w+)?[ \t]*$/m, 2],
      [/\b(True|False|None)\b/, 3],
      [/\b(input|range|len)\(/, 3],
      [/\bf["'][^"'\n]*\{/, 3],
      [/\[[^\]\n]{1,200}\bfor\s+\w+\s+in\s[^\]\n]{1,200}\]/, 5],
      [/^from\s+microbit\s+import\b/m, 8],
      [/^#!.*\bpython/, 10],
      [/^Traceback \(most recent call last\):/m, 10]
    ],
    javascript: JS_HINTS.concat([
      [/^#!.*\bnode\b/, 10]
    ]),
    typescript: JS_HINTS.concat([
      [/\binterface\s+\w+\s*(<[^>\n]*>)?\s*\{[^}\n]*$\s*\w+\??:/m, 5],
      [/[(,]\s*\w+\??:\s*(string|number|boolean|any|unknown|void|never)\b|\)\s*:\s*(string|number|boolean|void|Promise\b)/, 6],
      [/\b(let|const|var)\s+\w+\s*:\s*(string|number|boolean|any)\b/, 6],
      [/^[ \t]*(export\s+)?type\s+\w+\s*=/m, 4],
      [/\b(let|const)\s+\w+\s*:\s*\w+(<[^>\n]*>)?(\[\])?\s*=[^;\n]*;/, 3]
    ]),
    java: [
      [/\bpublic\s+static\s+void\s+main\b/, 8],
      [/\bSystem\.out\.print/, 8],
      [/\bnew\s+\w+<>/, 4],
      [/^import\s+java\./m, 8],
      [/@Override\b/, 4],
      // Java methods are camelCase; C# methods are PascalCase.
      [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w.]+(<[^>\n]*>)?(\[\])?\s+[a-z]\w*\s*\(/, 3],
      [/\bimplements\s+[A-Z]/, 3]
    ],
    csharp: [
      [/^using\s+[A-Z][\w.]*;/m, 6],
      [/\bConsole\.Write/, 8],
      [/\bMonoBehaviour\b|\bVector3\b/, 6],
      [/\b(public|private|protected)\s+(static\s+)?(override\s+)?[\w.]+(<[^>\n]*>)?(\[\])?\s+[A-Z]\w*\s*\(/, 2]
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
      [/^import\s+'(package|dart):/m, 10],
      [/\bvoid\s+main\s*\(\s*\)\s*\{/, 4],
      [/\b(Widget|BuildContext|StatelessWidget|StatefulWidget)\b/, 8],
      [/\bfinal\s+[\w<>?]+(\s+\w+)?\s*[=;]/, 2],
      [/^[ \t]*(const\s+)?[A-Z]\w*\(\s*this\.\w+\s*[,)]/m, 5]
    ],
    ruby: [
      [/^[ \t]*puts\s/m, 5],
      [/\bdo\s*\|\w+(\s*,\s*\w+)*\|/, 6],
      [/^[ \t]*def\s+\w+[^:\n]*$/m, 2],
      [/^[ \t]*end[ \t]*$/m, 2]
    ],
    lua: [
      [/\blocal\s+(function\s+)?\w+/, 5],
      [/\bthen[ \t]*$/m, 3],
      [/^[ \t]*--[^\n]*$/m, 2],
      [/~=|\.\.\s*["']|["']\s*\.\.\s*\w/, 3],
      [/^[ \t]*(local\s+)?function\s+[\w.:]+\s*\([^)\n]*\)[ \t]*$/m, 3]
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
      [/\bSELECT\b[^;]{0,500}\bFROM\b|\bINSERT\s+INTO\b|\bCREATE\s+TABLE\b|\bDELETE\s+FROM\b/i, 5]
    ],
    json: [
      [/^\s*[[{]\s*"[^"\n]+"\s*:/, 5],
      [/^[ \t]*"[^"\n]+"[ \t]*:[ \t]*["[{\d]/m, 3]
    ],
    yaml: [
      [/^---[ \t]*$/m, 2],
      [/^[\w-]+:[ \t]*$/m, 3],
      [/^[ \t]+- [\w"'-]/m, 2]
    ],
    markdown: [
      [/^#{1,6} \S/m, 4],
      [/\[[^\]\n]+\]\([^)\n]+\)/, 3],
      [/^[ \t]*[-*] \S/m, 2],
      [/^```/m, 4]
    ],
    makefile: [
      [/^[\w./%-]+[ \t]*:[^=\n]*\n\t/m, 6],
      [/\$\([A-Za-z_]+\)/, 3],
      [/^\.PHONY:/m, 8]
    ],
    arduino: [
      [/\bvoid\s+(setup|loop)\s*\(\s*\)/, 10],
      [/\b(pinMode|digitalWrite|digitalRead|analogRead|analogWrite)\(|\bSerial\.(begin|print)/, 6]
    ],
    latex: [
      [/\\(documentclass|usepackage|begin\{|section\{|end\{)/, 8]
    ],
    ini: [
      [/^\[[^\]\n]+\][ \t]*$/m, 4]
    ],
    dockerfile: [
      // FROM alone also starts SQL clauses, so look for an image tag or path.
      [/^FROM\s+[\w.-]+[:/@][\w./:@${}-]*(\s+AS\s+\w+)?[ \t]*$/m, 8],
      [/^(RUN|COPY|ADD|WORKDIR|EXPOSE|CMD|ENTRYPOINT|ENV|ARG|USER)\s/m, 5]
    ],
    powershell: [
      [/\b(Get|Set|New|Remove|Write|Read|Where|ForEach|Select|Invoke)-[A-Z][a-z]\w*\b/, 6],
      [/\$_\b/, 3]
    ],
    bash: [
      [/^#!.*\b(ba|z)?sh\b/, 10],
      [/^[ \t]*(fi|done|esac)[ \t]*$/m, 3],
      [/\[\[?\s+-[a-z]\s/, 4],
      [/^[ \t]*echo\s/m, 2],
      [/^[ \t]*(sudo\s+)?(npm|npx|yarn|pnpm|pip3?|git|cd|ls|apt(-get)?|brew|docker|curl|wget|mkdir|rm|chmod|export)\s/m, 3]
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

  function parsesAsJSON(text) {
    try {
      JSON.parse(text);
      return true;
    }
    catch (e) {
      return false;
    }
  }

  // A JSON document, or JSON Lines whose first lines are each JSON.
  function looksLikeJSON(code) {
    var trimmed = code.trim();
    if (!/^[[{]/.test(trimmed)) return false;
    if (parsesAsJSON(trimmed)) return true;
    var lines = trimmed.slice(0, SAMPLE_LENGTH).split('\n', 6).slice(0, 5);
    return lines.length > 1 && lines.every(function(line) {
      return /^\s*[[{]/.test(line) && parsesAsJSON(line);
    });
  }

  // Returns the best language for code, or undefined for plain text. A score
  // of 3 is needed, so that prose is not highlighted as code.
  function detect(hljs, code) {
    if (looksLikeJSON(code)) return 'json';
    var sample = code.slice(0, SAMPLE_LENGTH);
    var best, bestScore = 2;
    for (var i = 0; i < AUTO_LANGUAGES.length; i++) {
      var language = AUTO_LANGUAGES[i];
      if (!hljs.getLanguage(language)) continue;
      var hints = hintScore(language, sample) * Math.max(1, sample.length / 500);
      if (NEEDS_HINT.indexOf(language) !== -1 && hints <= 0) continue;
      // As in hljs.highlightAuto, a grammar that meets illegal syntax is out.
      var result = hljs.highlight(sample, { language: language, ignoreIllegals: false });
      if (result.illegal) continue;
      var score = result.relevance + hints;
      if (score > bestScore) {
        best = language;
        bestScore = score;
      }
    }
    return best;
  }

  // Like hljs.highlightAuto, but limited to AUTO_LANGUAGES and adjusted by
  // HINTS. Returns { language, value }; language is undefined for plain text.
  function highlightAuto(hljs, code) {
    var language = detect(hljs, code);
    var result = hljs.highlight(code, { language: language || 'plaintext' });
    return { language: language, value: result.value };
  }

  return {
    AUTO_LANGUAGES: AUTO_LANGUAGES,
    hintScore: hintScore,
    detect: detect,
    highlightAuto: highlightAuto
  };
});
