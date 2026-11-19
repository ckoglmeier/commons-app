import type { PollCommunication as Communication } from "@commons/contracts";

export function PollCommunication({ message }: { message: Communication }) {
  return <section className="poll-communication">
    <h2>{message.heading}</h2>
    {message.paragraphs.map((text, index) => <p key={index} style={{ whiteSpace: "pre-line" }}>{text}</p>)}
    {message.links.length ? <ul>{message.links.map((link, index) => <li key={index}><a className="poll-option-source" href={link.url} target="_blank" rel="noreferrer">{link.label}</a></li>)}</ul> : null}
  </section>;
}
