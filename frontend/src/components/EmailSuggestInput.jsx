import { useState } from 'react';
import { getRecentEmails, removeRecentEmail } from '../loginMemory';

export default function EmailSuggestInput({ value, onChange, hasError }) {
  const [recent, setRecent] = useState(getRecentEmails);
  const [open, setOpen]     = useState(false);
  const [active, setActive] = useState(-1);

  const query = value.trim().toLowerCase();
  const matches = recent.filter(e => e !== query && e.includes(query));
  const showList = open && matches.length > 0;

  const choose = (email) => {
    onChange(email);
    setOpen(false);
    setActive(-1);
  };

  const remove = (email) => {
    setRecent(removeRecentEmail(email));
    setActive(-1);
  };

  const handleKeyDown = (e) => {
    if (!showList) {
      if (e.key === 'ArrowDown' && matches.length) { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setActive(i => (i + 1) % matches.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setActive(i => (i <= 0 ? matches.length - 1 : i - 1));
      e.preventDefault();
    } else if (e.key === 'Enter' && active >= 0) {
      choose(matches[active]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className={`input-group email-suggest${hasError ? ' error' : ''}`}>
      <span className="material-icons-round input-icon">email</span>
      <input
        type="email"
        name="email"
        id="email"
        // Our own list replaces the browser's, which Firefox only opens on a second click.
        autoComplete={recent.length ? 'off' : 'email'}
        placeholder="Email address"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls="email-suggestions"
        aria-autocomplete="list"
        required
      />
      {showList && (
        <ul className="email-suggestions" id="email-suggestions" role="listbox">
          {matches.map((email, i) => (
            <li
              key={email}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              // mousedown + preventDefault keeps focus in the input so blur doesn't close the list first
              onMouseDown={(e) => { e.preventDefault(); choose(email); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="material-icons-round">history</span>
              <span className="email-suggestion-text">{email}</span>
              <button
                type="button"
                className="email-suggestion-remove"
                aria-label={`Remove ${email} from suggestions`}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); remove(email); }}
              >
                <span className="material-icons-round">close</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
