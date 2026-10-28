import type { Ripen } from '@ripen/sdk';
import { choiceStep, pickerModel } from './model.ts';
import { EN, type RipenTexts } from './texts.ts';

/**
 * Element classes are created inside a function: `HTMLElement` does not exist
 * in Node, and importing this package there (e.g. during SSR) must not throw.
 */

const BASE_STYLES = `
  :host {
    display: block;
    font: inherit;
    color: var(--ripen-text, inherit);
    --_accent: var(--ripen-accent, #2f6f4f);
    --_border: var(--ripen-border, color-mix(in srgb, currentColor 20%, transparent));
    --_radius: var(--ripen-radius, 10px);
    --_muted: var(--ripen-muted, color-mix(in srgb, currentColor 65%, transparent));
  }
  :host([hidden]) { display: none; }
  * { box-sizing: border-box; }
  button {
    font: inherit;
    padding: 0.5em 1em;
    border-radius: var(--_radius);
    border: 1px solid var(--_border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button.primary { background: var(--_accent); border-color: var(--_accent); color: var(--ripen-on-accent, #fff); }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--_accent); outline-offset: 2px; }
  .status { min-height: 1.4em; margin: 0.5em 0 0; color: var(--_muted); }
  .notice { padding: 0.75em; border-radius: var(--_radius); border: 1px solid var(--_accent); margin: 0 0 0.75em; }
`;

const PICKER_STYLES = `
  fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 0.5em; }
  legend { font-weight: 600; margin-bottom: 0.5em; padding: 0; }
  label.option {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25em 0.75em;
    padding: 0.75em;
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    cursor: pointer;
  }
  label.option:has(input:checked) { border-color: var(--_accent); }
  label.option input { margin: 0.2em 0 0; accent-color: var(--_accent); }
  .name { font-weight: 600; }
  .tag { font-weight: 400; color: var(--_muted); margin-left: 0.5em; }
  .details { grid-column: 2; color: var(--_muted); font-size: 0.92em; }
  .details ul { margin: 0.25em 0 0; padding-left: 1.1em; }
  .consent { display: flex; gap: 0.5em; align-items: flex-start; margin: 0.75em 0 0.5em; }
  .consent input { margin-top: 0.2em; accent-color: var(--_accent); }
`;

const FEEDBACK_STYLES = `
  p.question { margin: 0 0 0.6em; font-weight: 600; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5em; }
  textarea {
    display: block;
    width: 100%;
    min-height: 5em;
    margin: 0 0 0.5em;
    padding: 0.5em;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    resize: vertical;
  }
`;

type Attrs = Record<string, string | boolean | undefined>;

/** Builds DOM nodes. Text always goes through textContent, never innerHTML. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child !== null) node.append(child);
  }
  return node;
}

export interface RipenElementClasses {
  ChannelPicker: CustomElementConstructor;
  Feedback: CustomElementConstructor;
}

export function createElementClasses(): RipenElementClasses {
  abstract class RipenBase extends HTMLElement {
    protected client: Ripen | null = null;
    protected textsOverride: Partial<RipenTexts> = {};
    private unsubscribe: (() => void) | null = null;
    protected readonly root: ShadowRoot;

    constructor(styles: string) {
      super();
      this.root = this.attachShadow({ mode: 'open' });
      const sheet = document.createElement('style');
      sheet.textContent = BASE_STYLES + styles;
      this.root.append(sheet);
    }

    /** The Ripen client. Set it as a property: `element.ripen = ripen`. */
    get ripen(): Ripen | null {
      return this.client;
    }

    set ripen(client: Ripen | null) {
      this.unsubscribe?.();
      this.client = client;
      this.unsubscribe = client?.onChange(() => this.render()) ?? null;
      if (client && !client.session) client.start().catch(() => this.render());
      this.render();
    }

    /** Overrides for any of the strings, e.g. `element.texts = RU`. */
    get texts(): RipenTexts {
      return { ...EN, ...this.textsOverride };
    }

    set texts(texts: Partial<RipenTexts>) {
      this.textsOverride = texts;
      this.render();
    }

    connectedCallback(): void {
      this.render();
    }

    disconnectedCallback(): void {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }

    /** Replaces everything except the stylesheet. */
    protected replaceContent(...nodes: Node[]): void {
      while (this.root.childNodes.length > 1) this.root.lastChild!.remove();
      this.root.append(...nodes);
    }

    protected abstract render(): void;
  }

  /**
   * <ripen-channel-picker>: lets the user choose a channel and see what each one expects.
   * Fires `ripen-channel-change` with `detail: { channel }` after a successful switch.
   */
  class ChannelPicker extends RipenBase {
    private selected: string | null = null;
    private consent = false;
    private busy = false;
    private status = '';

    constructor() {
      super(PICKER_STYLES);
    }

    protected render(): void {
      const t = this.texts;
      const session = this.client?.session;
      if (!session) {
        this.replaceContent(h('p', { class: 'status', part: 'status' }, t.loading));
        return;
      }
      const model = pickerModel(session, t);
      const selected = this.selected ?? session.subscriber.channel;

      const fieldset = h('fieldset', { part: 'fieldset' }, h('legend', { part: 'title' }, t.pickerTitle));
      for (const option of model.options) {
        const input = h('input', { type: 'radio', name: 'channel', value: option.id, checked: option.id === selected, disabled: this.busy });
        input.addEventListener('change', () => this.choose(option.id));
        const details = h('div', { class: 'details' });
        if (option.description) details.append(h('div', {}, option.description));
        details.append(h('ul', {}, ...option.expectations.map((line) => h('li', {}, line))));
        fieldset.append(
          h(
            'label',
            { class: 'option', part: option.current ? 'option option-current' : 'option' },
            input,
            h('span', { class: 'name' }, option.name, option.current ? h('span', { class: 'tag' }, t.current) : null),
            details,
          ),
        );
      }

      const nodes: Node[] = [];
      if (model.demotionNotice) nodes.push(h('p', { class: 'notice', part: 'notice', role: 'note' }, model.demotionNotice));
      nodes.push(fieldset);

      if (choiceStep(session, selected, false) === 'ask-consent') {
        const checkbox = h('input', { type: 'checkbox', id: 'consent', checked: this.consent, disabled: this.busy });
        checkbox.addEventListener('change', () => {
          this.consent = checkbox.checked;
          this.render();
        });
        const join = h('button', { class: 'primary', part: 'button button-primary', disabled: !this.consent || this.busy }, t.join);
        join.addEventListener('click', () => void this.apply(selected));
        nodes.push(h('label', { class: 'consent', for: 'consent' }, checkbox, h('span', {}, t.consentLabel)), join);
      }

      nodes.push(h('p', { class: 'status', part: 'status', role: 'status', 'aria-live': 'polite' }, this.status));
      this.replaceContent(...nodes);
    }

    private choose(channelId: string): void {
      const session = this.client?.session;
      if (!session) return;
      this.selected = channelId;
      this.consent = false;
      this.status = '';
      if (choiceStep(session, channelId, false) === 'apply') {
        void this.apply(channelId);
      } else {
        this.render();
      }
    }

    private async apply(channelId: string): Promise<void> {
      if (!this.client) return;
      this.busy = true;
      this.render();
      try {
        await this.client.setChannel(channelId, { consent: this.consent });
        this.selected = null;
        this.status = this.texts.saved;
        this.dispatchEvent(new CustomEvent('ripen-channel-change', { detail: { channel: channelId }, bubbles: true, composed: true }));
      } catch {
        this.status = this.texts.failed;
      } finally {
        this.busy = false;
        this.consent = false;
        this.render();
      }
    }
  }

  /**
   * <ripen-feedback feature="optional-key">: a one-tap pulse, with an optional
   * written report after "Something broke". Fires `ripen-feedback` with `detail: { status }`.
   */
  class Feedback extends RipenBase {
    private step: 'ask' | 'describe' | 'done' = 'ask';
    private busy = false;
    private status = '';
    private draft = '';

    static get observedAttributes(): string[] {
      return ['feature'];
    }

    constructor() {
      super(FEEDBACK_STYLES);
    }

    attributeChangedCallback(): void {
      this.step = 'ask';
      this.render();
    }

    private get feature(): string | undefined {
      return this.getAttribute('feature') ?? undefined;
    }

    protected render(): void {
      const t = this.texts;
      const status = h('p', { class: 'status', part: 'status', role: 'status', 'aria-live': 'polite' }, this.status);

      if (this.step === 'done') {
        this.replaceContent(h('p', { class: 'status', part: 'status', role: 'status', 'aria-live': 'polite' }, t.thanks));
        return;
      }

      if (this.step === 'describe') {
        const textarea = h('textarea', { part: 'textarea', 'aria-label': t.reportPlaceholder, placeholder: t.reportPlaceholder, maxlength: '4000', disabled: this.busy });
        textarea.value = this.draft;
        textarea.addEventListener('input', () => {
          this.draft = textarea.value;
          send.disabled = this.busy || this.draft.trim() === '';
        });
        const send = h('button', { class: 'primary', part: 'button button-primary', disabled: this.busy || this.draft.trim() === '' }, t.send);
        send.addEventListener('click', () => void this.sendReport());
        const skip = h('button', { part: 'button', disabled: this.busy }, t.skip);
        skip.addEventListener('click', () => this.finish());
        this.replaceContent(textarea, h('div', { class: 'actions' }, send, skip), status);
        return;
      }

      const works = h('button', { part: 'button button-works', disabled: this.busy || !this.client }, t.works);
      works.addEventListener('click', () => void this.pulse('ok'));
      const broken = h('button', { part: 'button button-broken', disabled: this.busy || !this.client }, t.broken);
      broken.addEventListener('click', () => void this.pulse('broken'));
      this.replaceContent(h('p', { class: 'question', part: 'title' }, t.feedbackQuestion), h('div', { class: 'actions' }, works, broken), status);
    }

    private async pulse(value: 'ok' | 'broken'): Promise<void> {
      if (!this.client) return;
      await this.run(async () => {
        await this.client!.pulse(value, this.featureOption());
        this.dispatchEvent(new CustomEvent('ripen-feedback', { detail: { status: value }, bubbles: true, composed: true }));
        if (value === 'ok') this.finish();
        else this.step = 'describe';
      });
    }

    private async sendReport(): Promise<void> {
      if (!this.client) return;
      await this.run(async () => {
        await this.client!.report(this.draft.trim(), this.featureOption());
        this.draft = '';
        this.finish();
      });
    }

    private featureOption(): { feature?: string } {
      const feature = this.feature;
      return feature ? { feature } : {};
    }

    private finish(): void {
      this.step = 'done';
      this.status = '';
      this.render();
    }

    private async run(action: () => Promise<void>): Promise<void> {
      this.busy = true;
      this.status = '';
      this.render();
      try {
        await action();
      } catch {
        this.status = this.texts.failed;
      } finally {
        this.busy = false;
        this.render();
      }
    }
  }

  return { ChannelPicker, Feedback };
}

/** Registers `<ripen-channel-picker>` and `<ripen-feedback>`. Safe to call more than once. */
export function defineRipenElements(registry: CustomElementRegistry = customElements): void {
  const classes = createElementClasses();
  if (!registry.get('ripen-channel-picker')) registry.define('ripen-channel-picker', classes.ChannelPicker);
  if (!registry.get('ripen-feedback')) registry.define('ripen-feedback', classes.Feedback);
}

