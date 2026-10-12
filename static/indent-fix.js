/* global window */

// Detect and fix indentation problems that have one safe, mechanical fix.
//
// - Invisible "fake spaces" (non-breaking and other Unicode spaces) in the
//   indentation, usually from copying out of web pages, Word or chat apps.
//   They look like spaces but break Python.
// - Tab indentation mixed with space indentation (a classic Python error).
//   Leading tabs become spaces at the paste's own indent width.
// - A whole paste indented by an extra amount (copied from inside a block),
//   unless it contains multiline strings, whose contents would change.
//
// It never re-indents code structurally: guessing block levels needs a parser
// per language, and a wrong guess silently changes what Python code does.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.hasteIndentFix = factory();
  }
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
  var HAS_ODD_SPACE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;
  var LEADING = /^[ \t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*/;
  // Makefiles require tab-indented recipes; Go uses tabs plus alignment spaces.
  var KEEP_TABS = ['makefile', 'go'];

  function leading(line) {
    return LEADING.exec(line)[0];
  }

  function isBlank(line) {
    return line.replace(/\r$/, '') === leading(line);
  }

  // A target line followed (after any comment or blank lines) by a tab-indented recipe
  function looksLikeMakefile(text) {
    return /^[\w.%$()/-]+\s*:[^=\n]*\n(?:[ \t]*(?:#[^\n]*)?\n)*\t/m.test(text);
  }

  // Removing shared indentation would also change multiline string contents
  function hasMultilineStrings(text) {
    return /"""|'''|`/.test(text);
  }

  // Smallest space indentation, clamped to 2-8; 4 when nothing indents with spaces
  function indentUnit(lines) {
    var unit = 0;
    lines.forEach(function(line) {
      var lead = leading(line);
      if (!isBlank(line) && lead.length && lead.indexOf('\t') === -1) {
        unit = unit ? Math.min(unit, lead.length) : lead.length;
      }
    });
    return unit >= 2 && unit <= 8 ? unit : 4;
  }

  function expandTabs(lead, unit) {
    var column = 0;
    for (var i = 0; i < lead.length; i++) {
      column = lead[i] === '\t' ? (Math.floor(column / unit) + 1) * unit : column + 1;
    }
    return new Array(column + 1).join(' ');
  }

  function analyze(text, options) {
    var language = options && options.language;
    var lines = String(text).split('\n');
    var issues = [];
    var changed = 0;

    // 1. Unicode spaces in indentation become ordinary spaces
    lines = lines.map(function(line) {
      var lead = leading(line);
      if (!HAS_ODD_SPACE.test(lead)) return line;
      changed++;
      // The zero-width BOM (U+FEFF) is dropped; other Unicode spaces become a space
      return lead.replace(/\ufeff/g, '').replace(ODD_SPACE, ' ') + line.slice(lead.length);
    });
    if (changed) {
      issues.push({ type: 'fake-spaces', lines: changed,
        message: 'Replace invisible non-breaking spaces (' + plural(changed, 'line') + ')' });
    }

    // 2. Tabs mixed with spaces: expand leading tabs at the paste's indent width
    var keepTabs = KEEP_TABS.indexOf(language) !== -1 || (!language && looksLikeMakefile(text));
    var tabLed = 0, spaceLed = 0, spaceBeforeTab = 0;
    lines.forEach(function(line) {
      if (isBlank(line)) return;
      var lead = leading(line);
      if (lead[0] === '\t') tabLed++;
      else if (lead[0] === ' ') spaceLed++;
      if (/ \t/.test(lead)) spaceBeforeTab++;
    });
    if (!keepTabs && ((tabLed && spaceLed) || spaceBeforeTab)) {
      var unit = indentUnit(lines);
      changed = 0;
      lines = lines.map(function(line) {
        var lead = leading(line);
        if (lead.indexOf('\t') === -1) return line;
        changed++;
        return expandTabs(lead, unit) + line.slice(lead.length);
      });
      issues.push({ type: 'mixed-tabs', lines: changed, unit: unit,
        message: 'Convert tab indentation to ' + unit + ' spaces (' + plural(changed, 'line') + ')' });
    }

    // 3. Indentation shared by every non-blank line is removed
    var common = null;
    if (!hasMultilineStrings(text)) lines.forEach(function(line) {
      if (isBlank(line)) return;
      var lead = leading(line);
      if (common === null) common = lead;
      while (common && lead.indexOf(common) !== 0) common = common.slice(0, -1);
    });
    if (common) {
      lines = lines.map(function(line) {
        if (line.indexOf(common) === 0) return line.slice(common.length);
        return isBlank(line) ? line.replace(LEADING, '') : line;
      });
      issues.push({ type: 'extra-indent', width: common.length,
        message: 'Remove extra indentation from every line (' +
          (common.indexOf('\t') === -1 ? plural(common.length, 'space') : plural(common.length, 'tab')) + ')' });
    }

    return issues.length ? { issues: issues, fixed: lines.join('\n') } : null;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  return { analyze: analyze };
});
