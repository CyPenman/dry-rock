import { useState, type FormEvent } from 'react';
import { FEEDBACK_TOPICS, sendFeedback, type FeedbackTopic } from '../api/reports';
import { describeError } from '../api/serviceError';

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--ground-raised)', color: 'var(--text)' } as const;

type Status = { state: 'idle' } | { state: 'sending' } | { state: 'sent' } | { state: 'failed'; reason: string };

/**
 * General feedback (spec §6 Guide & about), emailed to the developer through
 * the same service as conditions reports (src/api/reports.ts). Name and email
 * are optional; an email address becomes the reply-to.
 */
export function FeedbackForm() {
  const [topic, setTopic] = useState<FeedbackTopic>('general');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || status.state === 'sending') return;
    setStatus({ state: 'sending' });
    try {
      await sendFeedback({
        topic,
        message: message.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      setStatus({ state: 'sent' });
      setMessage('');
    } catch (err) {
      setStatus({ state: 'failed', reason: describeError(err) });
    }
  }

  if (status.state === 'sent') {
    return (
      <div>
        <p>Thanks - your feedback has been sent.</p>
        <button
          type="button"
          onClick={() => setStatus({ state: 'idle' })}
          className="mt-2 rounded-full px-3 py-1.5 text-sm"
          style={{ background: 'var(--ground-raised)', color: 'var(--text)' }}
        >
          Send more
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What's it about?">
        {FEEDBACK_TOPICS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={topic === t.value}
            onClick={() => setTopic(t.value)}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: topic === t.value ? 'var(--signal)' : 'var(--ground-raised)',
              color: topic === t.value ? 'var(--ground)' : 'var(--text)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        rows={4}
        maxLength={2000}
        aria-label="Your feedback"
        placeholder="What worked, what didn't, which crag the app got wrong..."
        className="block w-full rounded border px-3 py-2 text-sm"
        style={FIELD_STYLE}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoComplete="name"
          aria-label="Name (optional)"
          placeholder="Name (optional)"
          className="h-11 w-full min-w-0 rounded border px-3 text-sm sm:flex-1"
          style={FIELD_STYLE}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={120}
          autoComplete="email"
          aria-label="Email, if you'd like a reply (optional)"
          placeholder="Email, for a reply (optional)"
          className="h-11 w-full min-w-0 rounded border px-3 text-sm sm:flex-1"
          style={FIELD_STYLE}
        />
      </div>
      <button
        type="submit"
        disabled={!message.trim() || status.state === 'sending'}
        className="h-11 rounded px-4 text-sm font-medium disabled:opacity-40"
        style={{ background: 'var(--signal)', color: 'var(--ground)' }}
      >
        {status.state === 'sending' ? 'Sending...' : 'Send feedback'}
      </button>
      {status.state === 'failed' && (
        <p style={{ color: 'var(--warning)' }}>
          Couldn't send: {status.reason}. Your message is still here to try again.
        </p>
      )}
    </form>
  );
}
