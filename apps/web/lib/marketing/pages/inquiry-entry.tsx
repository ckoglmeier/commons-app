import { feedbackContactEmail } from '@/lib/feedback-contact';
import css from './pages.module.css';
export function InquiryEntry({kind}:{kind:'organizer'|'destination'|'travel-assistant'}){
 const subject=kind==='organizer'?'Commons trip bundle inquiry':kind==='destination'?'Commons destination partnership':'Commons travel assistant partnership';
 return <div><a className={css.primary} href={`mailto:${feedbackContactEmail}?subject=${encodeURIComponent(subject)}`}>Email Commons</a><p>Tell us about your organization and the trips you have in mind. Opens your email app.</p></div>;
}
