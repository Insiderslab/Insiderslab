/**
 * Event Timeline
 *
 * The post's audit log (PostEvent), oldest first, in Italian: who did what
 * and when, with the details stored in the event (changes, errors, deadline).
 */

import { describeEvent, formatDateTime, TONE_DOT, type EventLike } from "./helpers";

export interface TimelineEvent extends EventLike {
  id: string;
  createdAt: Date | string;
}

export default function EventTimeline({ events, timezone }: { events: TimelineEvent[]; timezone: string }) {
  if (events.length === 0) return <p className="text-sm text-muted">Nessuna attività registrata.</p>;

  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {events.map((event) => {
        const description = describeEvent(event, timezone);
        return (
          <li key={event.id} className="relative">
            <span
              className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${TONE_DOT[description.tone]}`}
              aria-hidden
            />
            <p className="text-sm text-foreground">{description.title}</p>
            <p className="text-xs text-muted">
              <time dateTime={new Date(event.createdAt).toISOString()}>{formatDateTime(event.createdAt, timezone)}</time>
            </p>
            {description.details.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {description.details.map((detail, i) => (
                  <li key={i} className="whitespace-pre-wrap break-words">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
