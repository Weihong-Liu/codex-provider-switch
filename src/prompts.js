import readline from 'node:readline';

import pc from 'picocolors';

export const FIELD_BACK = Symbol('field-back');
export const FIELD_CANCEL = Symbol('field-cancel');

export async function fieldInput({
  message,
  initialValue = '',
  placeholder = '',
  mask = false,
  validate,
  allowEmpty = false,
  isFirst = false,
  isLast = false,
}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return fallbackInput({ message, initialValue, placeholder, mask, validate, allowEmpty });
  }

  const prompt = new FieldPrompt({
    message,
    initialValue,
    placeholder,
    mask,
    validate,
    allowEmpty,
    isFirst,
    isLast,
  });

  return prompt.run();
}

async function fallbackInput({ message, initialValue = '', placeholder = '', mask = false, validate, allowEmpty = false }) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = initialValue ? ` (${mask ? maskValue(initialValue) : initialValue})` : placeholder ? ` (${placeholder})` : '';

  while (true) {
    const value = await new Promise((resolve) => {
      rl.question(`${message}${suffix}: `, resolve);
    });
    const finalValue = value || initialValue;
    const error = validateField(finalValue, validate, allowEmpty);

    if (!error) {
      rl.close();
      return finalValue;
    }

    process.stdout.write(`${pc.yellow(error)}\n`);
  }
}

class FieldPrompt {
  constructor(options) {
    this.options = options;
    this.value = String(options.initialValue || '');
    this.cursor = this.value.length;
    this.error = '';
    this.previousFrameLines = 0;
    this.keyHandler = this.onKeypress.bind(this);
    this.resolve = null;
  }

  run() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', this.keyHandler);
      process.stdout.write('\n');
      process.stdout.write('\x1B[?25l');
      this.render();
    });
  }

  finish(value) {
    process.stdin.off('keypress', this.keyHandler);
    process.stdin.setRawMode(false);

    if (value === FIELD_BACK || value === FIELD_CANCEL) {
      clearPreviousFrame(this.previousFrameLines);
      this.previousFrameLines = 0;
    } else {
      this.render({ state: 'submit' });
      process.stdout.write('\n');
    }

    process.stdout.write('\x1B[?25h');
    this.resolve(value);
  }

  onKeypress(char, key = {}) {
    if (key.ctrl && key.name === 'c') {
      this.finish(FIELD_CANCEL);
      return;
    }

    if (key.name === 'escape') {
      this.finish(FIELD_BACK);
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      const error = validateField(this.value, this.options.validate, this.options.allowEmpty);
      if (error) {
        this.error = error;
        this.render();
        return;
      }

      this.finish(this.value);
      return;
    }

    if (key.name === 'backspace') {
      if (this.cursor > 0) {
        this.value = `${this.value.slice(0, this.cursor - 1)}${this.value.slice(this.cursor)}`;
        this.cursor -= 1;
      }
      this.error = '';
      this.render();
      return;
    }

    if (key.name === 'delete') {
      if (this.cursor < this.value.length) {
        this.value = `${this.value.slice(0, this.cursor)}${this.value.slice(this.cursor + 1)}`;
      }
      this.error = '';
      this.render();
      return;
    }

    if (key.name === 'left') {
      this.cursor = Math.max(this.cursor - 1, 0);
      this.render();
      return;
    }

    if (key.name === 'right') {
      this.cursor = Math.min(this.cursor + 1, this.value.length);
      this.render();
      return;
    }

    if (key.name === 'home') {
      this.cursor = 0;
      this.render();
      return;
    }

    if (key.name === 'end') {
      this.cursor = this.value.length;
      this.render();
      return;
    }

    if (key.name === 'tab' && !this.value && this.options.placeholder) {
      this.value = this.options.placeholder;
      this.cursor = this.value.length;
      this.error = '';
      this.render();
      return;
    }

    if (char && !key.ctrl && !key.meta && char >= ' ') {
      this.value = `${this.value.slice(0, this.cursor)}${char}${this.value.slice(this.cursor)}`;
      this.cursor += char.length;
      this.error = '';
      this.render();
    }
  }

  render({ state = 'active' } = {}) {
    clearPreviousFrame(this.previousFrameLines);

    const lines = [
      `${renderMarker(state)}  ${this.options.message}`,
      `${pc.gray('│')}  ${this.renderValue({ showCursor: state === 'active' })}`,
    ];

    if (state === 'active' && this.error) {
      lines.push(`${pc.gray('│')}  ${pc.yellow(this.error)}`);
    }

    if (state === 'active') {
      lines.push(`${pc.gray('│')}  ${pc.dim(this.hintText())}`);
    }

    const frame = lines.join('\n');
    process.stdout.write(frame);
    this.previousFrameLines = lines.length;
  }

  renderValue({ showCursor = true } = {}) {
    const displayValue = this.options.mask ? maskValue(this.value) : this.value;

    if (!displayValue && this.options.placeholder) {
      return pc.dim(this.options.placeholder);
    }

    if (!showCursor) {
      return pc.dim(displayValue);
    }

    const before = displayValue.slice(0, this.cursor);
    const current = displayValue[this.cursor] || ' ';
    const after = displayValue.slice(this.cursor + 1);
    return `${before}${pc.inverse(current)}${after}`;
  }

  hintText() {
    const parts = [this.options.isLast ? 'Enter 保存' : 'Enter 下一步'];

    parts.push(this.options.isFirst ? 'Esc 返回上一层' : 'Esc 上一步');
    parts.push('Ctrl+C 返回上一层');
    return parts.join('  ');
  }
}

function validateField(value, validate, allowEmpty) {
  if (allowEmpty && !value) {
    return undefined;
  }

  if (!validate) {
    return undefined;
  }

  const result = validate(value);
  return result instanceof Error ? result.message : result;
}

function maskValue(value) {
  return String(value || '').replace(/./g, '*');
}

function renderMarker(state) {
  return state === 'submit' ? pc.green('◇') : pc.cyan('◆');
}

function clearPreviousFrame(lines) {
  if (!lines) {
    return;
  }

  process.stdout.write(`\x1B[${lines - 1}A`);

  for (let index = 0; index < lines; index += 1) {
    process.stdout.write('\x1B[2K\r');
    if (index < lines - 1) {
      process.stdout.write('\x1B[1B');
    }
  }

  process.stdout.write(`\x1B[${lines - 1}A`);
}
