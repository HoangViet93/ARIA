'use strict';

/**
 * Bridges lib/ (CommonJS, also used by the main process) into the renderer as
 * a real ES module. Bindings are listed explicitly because `export *` cannot
 * discover named exports of a CommonJS module at bundle time — it silently
 * produces a module with no named exports at all.
 */

import itemModel from '../../lib/itemModel.js';
import itemTypes from '../../lib/itemTypes.js';
import latexUtil from '../../lib/latex.js';
import docDiffLib from '../../lib/docDiff.js';
import textDiffLib from '../../lib/textDiff.js';

export const {
  emptyDoc, makeItem, newItem, formatCode, allocateCode, groupRuns,
  walk, walkDoc, locate, findItem, flatten, countItems, subtreeCodes,
  removeItem, insertItem, moveItem, moveUp, moveDown, indentItem, outdentItem,
  isAncestorOf, foreignFieldKeys, fieldOrderFor, isRichKey,
  generateDataTex, parseDataTex, validate, buildTraceability,
} = itemModel;

export const {
  ITEM_TYPES, TYPE_ORDER, ASIL_LEVELS, VERIFICATION_METHODS, MULTI_SEP,
  typeDef, fieldsOf, fieldDef, allFieldKeys, splitMulti, joinMulti,
  visibleFields, isEnumFields, isFlagOn, SETTING_SCOPES, DELAY_UNITS, scopeLabel,
} = itemTypes;

export const { escapeText, unescapeText } = latexUtil;

// Diffing runs in the renderer, not over IPC: the compare screen re-diffs on
// every filter change and selection, and a round-trip per keystroke would be
// felt. Documents are fetched by commit once and cached.
export const { diffDocs, summaryLine, indexDoc } = docDiffLib;
export const { wordDiff, unifiedDiff } = textDiffLib;
