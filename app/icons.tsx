// Small inline icons (no icon library). 24×24, stroke = currentColor.
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  brief: () => (<svg {...base} aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>),
  papers: () => (<svg {...base} aria-hidden="true"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></svg>),
  topics: () => (<svg {...base} aria-hidden="true"><circle cx="7" cy="7" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="7" cy="17" r="3" /><circle cx="17" cy="17" r="3" /></svg>),
  shortlist: () => (<svg {...base} aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>),
  coverage: () => (<svg {...base} aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>),
  how: () => (<svg {...base} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" /></svg>),
  menu: () => (<svg {...base} aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>),
  close: () => (<svg {...base} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>),
  search: () => (<svg {...base} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>),
  grid: () => (<svg {...base} aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>),
  list: () => (<svg {...base} aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>),
  pulse: () => (<svg {...base} aria-hidden="true" strokeWidth={2.4}><path d="M3 13h4l2.5-6 4 12 2.5-6H21" /></svg>),
  arrowL: () => (<svg {...base} aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>),
  arrowR: () => (<svg {...base} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>),
};
