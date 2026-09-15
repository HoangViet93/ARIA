'use strict';

/**
 * itemTypes.js — the single declaration of what an item type is.
 *
 * Everything type-aware reads from here: the edit form, the read-only document
 * renderer, the table view, data.tex generation (which field is plain vs rich),
 * the validator, and the LaTeX field labels. Adding a field to a type is a
 * one-line change here plus a `\srslabel` line in resources/template.tex.
 *
 * field.kind:
 *   text  — free plain text
 *   enum  — one value from `options`
 *   multi — zero or more of `options`, stored joined by "; "
 *   ref   — plain text holding another item's code (validated, autocompleted)
 *   refs  — several codes at once, joined by "; " (validated per entry)
 *   rich  — LaTeX subset produced by richtext.js (NOT escaped on save)
 *   valuelist — an ordered list of allowed values, stored joined by "; ", one
 *           of which is the default. The default is NOT a separate control: it
 *           is picked inside the list, so "default is not one of the values"
 *           cannot happen. The widget writes two keys — its own and the item's
 *           `defaultValue`.
 *   flag  — a tick box. Stored as "1" when on, absent when off.
 *   uisettings / uiwarnings — repeatable sub-records for the UI/UX impact of a
 *           function or design. Like `steps` they live OUTSIDE item.fields, at
 *           item.settings and item.warnings, and are declared here only so the
 *           form knows where to place them.
 *   steps — ordered rows of {action, expected}. Unlike every other kind this
 *           one does NOT live in item.fields; it lives at item.steps, because a
 *           flat string map is the wrong shape for it and quietly stringifying
 *           an array is exactly the kind of silent corruption this codebase
 *           keeps finding. Declared here only so the form knows where to put it.
 */

const ASIL_LEVELS = ['QM', 'ASIL A', 'ASIL B', 'ASIL C', 'ASIL D'];

const VERIFICATION_METHODS = [
  'Test', 'Analysis', 'Inspection', 'Review', 'Simulation', 'Demonstration',
];

const TEST_LEVELS = ['Unit', 'SIL', 'MIL', 'HIL', 'Bench', 'Vehicle'];

const PHYSICAL_LAYERS = ['CAN', 'LIN', 'Ethernet', 'Hardwired'];

/**
 * Where a user-facing setting survives to. Stored as the ASCII key, shown as the
 * label: the file stays stable if the wording is ever reworded.
 */
const SETTING_SCOPES = [
  { key: 'profile', label: 'Theo profile lái xe' },
  { key: 'global', label: 'Global (toàn xe)' },
  { key: 'volatile', label: 'Không lưu (reset mỗi chu kỳ)' },
];

const scopeLabel = (key) =>
  (SETTING_SCOPES.find((s) => s.key === key) || {}).label || key || '';

const DELAY_UNITS = ['ms', 's'];

/** Test levels that exercise real hardware — used by the coverage checks. */
const HARDWARE_LEVELS = ['HIL', 'Bench', 'Vehicle'];

const MULTI_SEP = '; ';

/**
 * An interface signal or a calibration is EITHER a scalar (a unit, a range) OR
 * an enumeration (a fixed list of named values). There is deliberately no
 * "data type" field to say which: having a value list IS what makes it an
 * enumeration. One less field to keep consistent, one less way to be wrong.
 */
function isEnumFields(fields) {
  return splitMulti((fields || {}).values).length > 0;
}

/**
 * The UI/UX sticker. Function only ever gets the plain yes/no tick — it states
 * WHETHER a requirement touches the HMI, not the detail of how, so it carries
 * no settings/warnings sub-records. Design carries the full detail: ticking it
 * is what puts the item into the UI/UX report, and the two sub-record blocks
 * are the detail. An item can affect the HMI without introducing either, so
 * the tick is the source of truth rather than "has settings or warnings".
 */
const UIUX_FLAG_ONLY = [
  { key: 'uiImpact', label: 'Ảnh hưởng UI/UX', kind: 'flag',
    hint: 'Tick nếu yêu cầu này chạm tới giao diện người dùng.' },
];

const UIUX_FIELDS = [
  ...UIUX_FLAG_ONLY,
  { key: 'settings', label: 'Setting người dùng', kind: 'uisettings', needs: 'uiImpact' },
  { key: 'warnings', label: 'Cảnh báo', kind: 'uiwarnings', needs: 'uiImpact' },
];

const ITEM_TYPES = {
  information: {
    key: 'information',
    label: 'Information',
    short: 'INFO',
    icon: 'I',
    hint: 'Chương mô tả, thuật ngữ, phạm vi — không mang yêu cầu kiểm chứng được.',
    fields: [],
  },

  function: {
    key: 'function',
    label: 'Function',
    short: 'FUNC',
    icon: 'F',
    hint: 'Chức năng hệ thống nhìn từ bên ngoài vào.',
    fields: [
      {
        key: 'deployMaster',
        label: 'Master',
        kind: 'rich',
        compact: true, // short value (a Component name/mention) — one line in the properties table, not its own wide block
        placeholder: 'e.g. BCM — type @ to mention a Component',
      },
      {
        key: 'deploySlave',
        label: 'Slave',
        kind: 'rich',
        compact: true,
        placeholder: 'e.g. Door Module — type @ to mention a Component',
      },
      {
        key: 'rationale',
        label: 'Rationale',
        kind: 'text',
        placeholder: 'e.g. why this function is needed',
      },
      ...UIUX_FLAG_ONLY,
    ],
  },

  design: {
    key: 'design',
    label: 'Design',
    short: 'DSGN',
    icon: 'D',
    hint: 'Cách hiện thực một Function, kèm điều kiện vào/ra và mức ASIL.',
    fields: [
      {
        key: 'functionCode',
        label: 'Function code',
        kind: 'ref',
        refType: 'function',
        placeholder: 'vd. BCM-0002',
      },
      {
        key: 'asil',
        label: 'ASIL level',
        kind: 'enum',
        options: ASIL_LEVELS,
        default: 'QM',
      },
      {
        key: 'verification',
        label: 'Verification methods',
        kind: 'text',
        placeholder: 'vd. Test; Analysis; Review',
        suggest: 'verification',
      },
      { key: 'enterCondition', label: 'Enter condition', kind: 'rich' },
      { key: 'exitCondition', label: 'Exit condition', kind: 'rich' },
      ...UIUX_FIELDS,
    ],
  },

  dvp: {
    key: 'dvp',
    label: 'DVP',
    short: 'DVP',
    icon: 'V',
    color: 'dvp',
    hint: 'Test case kiểm chứng một Design hoặc Function. Không chứa kết quả chạy thử.',
    fields: [
      {
        key: 'verifies',
        label: 'Kiểm chứng cho',
        kind: 'refs',
        refType: ['design', 'function'],
        placeholder: 'vd. EPB-0008; EPB-0010',
      },
      { key: 'testLevel', label: 'Mức kiểm thử', kind: 'enum', options: TEST_LEVELS, default: 'HIL' },
      { key: 'preCondition', label: 'Điều kiện tiên quyết', kind: 'rich' },
      { key: 'steps', label: 'Các bước kiểm thử', kind: 'steps' },
      { key: 'postCondition', label: 'Trạng thái sau khi chạy', kind: 'rich' },
      { key: 'acceptance', label: 'Tiêu chí chấp nhận', kind: 'rich' },
    ],
  },

  calibration: {
    key: 'calibration',
    label: 'Calibration',
    short: 'CAL',
    icon: 'C',
    color: 'calibration',
    hint: 'Biến hiệu chuẩn dùng trong thiết kế. Gõ @ trong mô tả để trỏ tới nó.',
    tableEnv: 'calgroup', // a run of consecutive Calibration items renders as one table — same mechanism as Interface/Component
    fields: [
      {
        key: 'symbol',
        label: 'Ký hiệu biến',
        kind: 'text',
        placeholder: 'vd. F_clamp_max',
        // Maps to a real ECU variable, and \calref renders it in place of the
        // item code — so it has to be a valid identifier and unique.
        pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
        patternHint: 'Bắt đầu bằng chữ hoặc _, chỉ dùng chữ, số và _',
        required: true,
      },
      { key: 'values', label: 'Giá trị cho phép', kind: 'valuelist' },
      { key: 'unit', label: 'Đơn vị', kind: 'text', placeholder: 'vd. kN, ms, km/h', suggest: 'unit', onlyWhen: 'scalar' },
      { key: 'defaultValue', label: 'Giá trị mặc định', kind: 'text', placeholder: 'vd. 18.5', onlyWhen: 'scalar' },
      { key: 'minValue', label: 'Giá trị nhỏ nhất', kind: 'text', placeholder: 'tùy chọn', onlyWhen: 'scalar' },
      { key: 'maxValue', label: 'Giá trị lớn nhất', kind: 'text', placeholder: 'tùy chọn', onlyWhen: 'scalar' },
    ],
  },

  interface: {
    key: 'interface',
    label: 'Interface',
    short: 'IF',
    icon: 'S',
    color: 'interface',
    hint: 'Tín hiệu vào/ra của ECU. Một dãy Interface liền nhau sẽ hiện thành bảng.',
    // Rendered as a table row, so keep the field set to what fits one line.
    tableEnv: 'ifacegroup',
    fields: [
      { key: 'values', label: 'Giá trị cho phép', kind: 'valuelist' },
      { key: 'unit', label: 'Đơn vị', kind: 'text', placeholder: 'vd. km/h, -', suggest: 'unit', onlyWhen: 'scalar' },
      { key: 'defaultValue', label: 'Giá trị mặc định', kind: 'text', placeholder: 'vd. 0', onlyWhen: 'scalar' },
      { key: 'physical', label: 'Lớp vật lý', kind: 'enum', options: PHYSICAL_LAYERS },
      // rich, not text: lets a sender/receiver be @ mentioned to a Component
      // item instead of only ever being a free-typed name.
      { key: 'senderEcu', label: 'ECU gửi', kind: 'rich' },
      { key: 'receiverEcu', label: 'ECU nhận', kind: 'rich' },
    ],
  },

  component: {
    key: 'component',
    label: 'Component',
    short: 'COMP',
    icon: 'M',
    color: 'component',
    hint: 'Một ECU hay module phần mềm. Gõ @ trong mô tả Design (hoặc ECU gửi/nhận của ' +
      'Interface) để trỏ tới nó; đổi tên ở đây thì mọi chỗ @ mention đổi theo.',
    // Rendered as a table row, exactly like Interface — a run of consecutive
    // Component items collapses into one table so a component registry reads
    // like a list, not like N separate requirement sections.
    tableEnv: 'compgroup',
    fields: [],
  },
};

const TYPE_ORDER = ['information', 'function', 'design', 'dvp', 'calibration', 'interface', 'component'];

function typeDef(type) {
  return ITEM_TYPES[type] || ITEM_TYPES.information;
}

function fieldsOf(type) {
  return typeDef(type).fields;
}

/**
 * The fields worth showing for this item right now. A signal with a value list
 * has no unit and no range; one without has no value list to pick a default
 * from. Generation still writes every stored key, so switching back and forth
 * never drops what was typed.
 */
function visibleFields(type, fields) {
  const en = isEnumFields(fields);
  return fieldsOf(type).filter((f) => {
    if (f.onlyWhen === 'scalar') return !en;
    if (f.onlyWhen === 'enum') return en;
    // A field gated behind a tick box only appears once that box is ticked.
    if (f.needs && !isFlagOn((fields || {})[f.needs])) return false;
    return true;
  });
}

/** A `flag` field is on when it holds anything truthy that is not "0". */
function isFlagOn(value) {
  const v = String(value == null ? '' : value).trim();
  return v !== '' && v !== '0';
}

function fieldDef(type, key) {
  return fieldsOf(type).find((f) => f.key === key) || null;
}

/** Every field key declared by any type — used when re-typing an item. */
function allFieldKeys() {
  const set = new Set();
  TYPE_ORDER.forEach((t) => fieldsOf(t).forEach((f) => set.add(f.key)));
  return [...set];
}

/** Kinds whose value is several "; "-separated entries. */
const MULTI_KINDS = new Set(['multi', 'refs']);

/** The one field kind stored outside item.fields. */
const STEPS_KEY = 'steps';

function splitMulti(value) {
  return String(value || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinMulti(values) {
  return (values || []).join(MULTI_SEP);
}

module.exports = {
  ITEM_TYPES,
  TYPE_ORDER,
  ASIL_LEVELS,
  VERIFICATION_METHODS,
  TEST_LEVELS,
  PHYSICAL_LAYERS,
  HARDWARE_LEVELS,
  MULTI_KINDS,
  STEPS_KEY,
  SETTING_SCOPES,
  DELAY_UNITS,
  scopeLabel,
  isFlagOn,
  MULTI_SEP,
  typeDef,
  fieldsOf,
  visibleFields,
  isEnumFields,
  fieldDef,
  allFieldKeys,
  splitMulti,
  joinMulti,
};
