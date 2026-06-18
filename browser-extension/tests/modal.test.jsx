// Smoke test for the React blocking modal. Server-renders it (node env, no
// jsdom needed) to confirm the component tree — including Framer Motion + Lucide
// + the design-system styles — builds without throwing and surfaces the right
// content for each verdict/mode combination.
import { renderToStaticMarkup } from 'react-dom/server';
import Modal from '../src/content/Modal.jsx';

const render = (verdict, mode) =>
  renderToStaticMarkup(<Modal verdict={verdict} mode={mode} onChoose={() => {}} />);

describe('blocking Modal', () => {
  test('renders a hard block with an "Edit prompt" action only', () => {
    const html = render(
      { decision: 'block', reason: 'Possible prompt injection', categories: ['injection'], pii: [], secrets: [], source: 'engine' },
      'block_redact',
    );
    expect(html).toContain('Prompt blocked');
    expect(html).toContain('Edit prompt');
    expect(html).not.toContain('Redact &amp; send');
    expect(html).toContain('THREAT: injection');
  });

  test('renders a redactable verdict with a "Redact & send" action', () => {
    const html = render(
      { decision: 'redact', reason: 'PII: EMAIL_ADDRESS', categories: ['pii'], pii: ['EMAIL_ADDRESS'], secrets: [], source: 'engine' },
      'block_redact',
    );
    expect(html).toContain('Sensitive data detected');
    expect(html).toContain('Redact &amp; send');
    expect(html).toContain('PII: EMAIL_ADDRESS');
  });

  test('warn mode offers "Send anyway"', () => {
    const html = render(
      { decision: 'redact', reason: 'Secrets: AWS_ACCESS_KEY', categories: ['secret'], pii: [], secrets: ['AWS_ACCESS_KEY'], source: 'engine' },
      'warn',
    );
    expect(html).toContain('Send anyway');
    expect(html).toContain('SECRET: AWS_ACCESS_KEY');
  });

  test('shows the offline note when the verdict came from local rules', () => {
    const html = render(
      { decision: 'redact', reason: 'PII', categories: ['pii'], pii: ['US_SSN'], secrets: [], source: 'local' },
      'block_redact',
    );
    expect(html).toContain('Engine offline');
  });
});
