import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => <Icon><path d="m3 10 9-7 9 7v10H7V12h10v8" /></Icon>;
export const QuestionIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 16.5h.01" /></Icon>;
export const CalendarIcon = () => <Icon><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></Icon>;
export const WalletIcon = () => <Icon><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v13H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3" /><path d="M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z" /></Icon>;
export const ImageIcon = () => <Icon><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></Icon>;
export const MessageIcon = () => <Icon><path d="M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v9Z" /></Icon>;
export const UsersIcon = () => <Icon><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3" /><path d="M16 4.3a3 3 0 0 1 0 5.4M22 20v-1.5a4 4 0 0 0-3-3.65" /></Icon>;
export const ClockIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Icon>;
export const ChevronRightIcon = () => <Icon><path d="m9 18 6-6-6-6" /></Icon>;
export const BookmarkIcon = () => <Icon><path d="M6 4h12v17l-6-4-6 4Z" /></Icon>;
export const ChevronLeftIcon = () => <Icon><path d="m15 18-6-6 6-6" /></Icon>;
export const CloseIcon = () => <Icon><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const ArrowUpIcon = () => <Icon><path d="m12 19V5m-6 6 6-6 6 6" /></Icon>;
export const CheckIcon = () => <Icon><path d="m5 12 4 4L19 6" /></Icon>;
export const ReceiptIcon = () => <Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></Icon>;
export const PinIcon = () => <Icon><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></Icon>;
export const InfoIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 19h14" /></Icon>;
export const FileTextIcon = () => <Icon><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Icon>;
export const RouteIcon = () => <Icon><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" /></Icon>;
export const ShareIcon = () => <Icon><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></Icon>;
export const LockIcon = () => <Icon><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>;
export const LinkIcon = () => <Icon><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.14" /><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14" /></Icon>;
export const MoreIcon = () => <Icon><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
export const EditIcon = () => <Icon><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></Icon>;
export const LogOutIcon = () => <Icon><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></Icon>;
export const LogInIcon = () => <Icon><path d="m14 7-5 5 5 5M9 12h12" /><path d="M10 4H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4" /></Icon>;
export const MicrophoneIcon = () => <Icon><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></Icon>;
