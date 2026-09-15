import { useState, type CSSProperties } from 'react';
import { MEMBERS, type Member } from './members';
import './home/members.css';

const POSITIONS: Record<string, { x: number; y: number }> = {
  chui: { x: .02, y: .35 },
  hu: { x: .18, y: 0 },
  a: { x: .43, y: .20 },
  mx: { x: .35, y: .61 },
  guo: { x: .51, y: .81 },
  chili: { x: .72, y: .97 },
  'daimeng-hf': { x: .96, y: 1 },
};

function LinkLogo({ github, imagePath }: { github: boolean; imagePath?: string }) {
  const [failed, setFailed] = useState(false);
  if (!github && imagePath && !failed) {
    return <img className="member-link-logo" src={`${import.meta.env.BASE_URL}members/${imagePath}`} alt="" onError={() => setFailed(true)} />;
  }
  return github ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.922c.563.104.768-.244.768-.543 0-.267-.01-.975-.015-1.913-3.13.68-3.79-1.51-3.79-1.51-.512-1.3-1.25-1.647-1.25-1.647-1.023-.7.077-.686.077-.686 1.13.08 1.725 1.16 1.725 1.16 1.006 1.724 2.64 1.226 3.283.938.102-.728.394-1.226.716-1.508-2.499-.284-5.126-1.25-5.126-5.566 0-1.23.44-2.235 1.16-3.023-.117-.284-.503-1.43.11-2.981 0 0 .945-.303 3.094 1.155A10.78 10.78 0 0 1 12 6.18c.956.005 1.918.13 2.816.379 2.148-1.458 3.09-1.155 3.09-1.155.616 1.55.23 2.697.114 2.981.722.788 1.158 1.793 1.158 3.023 0 4.327-2.632 5.278-5.138 5.557.404.35.765 1.04.765 2.096 0 1.514-.014 2.735-.014 3.106 0 .302.202.653.774.542A11.25 11.25 0 0 0 12 .75Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18-3-3.5-3-14.5 0-18Z" />
    </svg>
  );
}

function ProfileLink({ url, name, github = false, imagePath }: { url: string; name: string; github?: boolean; imagePath?: string }) {
  const label = github ? 'GitHub' : '个人网页';
  let href: string | undefined;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') href = parsed.href;
  } catch { /* Empty and incomplete links remain inactive until filled in. */ }
  return href ? (
    <a className="member-link" data-link={github ? 'github' : 'website'} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name}的${label}`} title={label}>
      <LinkLogo github={github} imagePath={imagePath} />
    </a>
  ) : (
    <span className="member-link member-link--empty" data-link={github ? 'github' : 'website'} role="link" aria-disabled="true" aria-label={`${name}的${label}尚未填写`} title={`${label}尚未填写`}>
      <LinkLogo github={github} imagePath={imagePath} />
    </span>
  );
}

function MemberProfile({ member, index }: { member: Member; index: number }) {
  const [failed, setFailed] = useState(false);
  const name = member.name.trim() || `成员 ${String(index + 1).padStart(2, '0')}`;
  const intro = member.intro.trim() || '介绍待填写';
  const position = POSITIONS[member.id];
  return (
    <article className="member-profile" data-member-id={member.id} data-links={member.links.length} style={{ '--member-base-x': position.x, '--member-base-y': position.y } as CSSProperties}>
      <div className="member-avatar">
        {failed ? <span className="member-avatar-fallback" aria-label={`${name}的头像`}>{member.name.trim().slice(0, 1) || index + 1}</span> : (
          <img src={`${import.meta.env.BASE_URL}members/${member.avatar}`} alt={`${name}的头像`} draggable={false} onError={() => setFailed(true)} />
        )}
      </div>
      <h2 className="member-name" title={name}>{name}</h2>
      <p className="member-intro" title={intro}>{intro}</p>
      {member.links.length > 0 && <div className="member-links">
        {member.links.includes('website') && <ProfileLink url={member.website} name={name} imagePath={member.websiteLogo} />}
        {member.links.includes('github') && <ProfileLink url={member.github} name={name} github />}
      </div>}
    </article>
  );
}

export default function MembersScreen() {
  return (
    <div id="home-panel-items" className="home-members" role="region" aria-label="七位成员" tabIndex={0}>
      <div className="members-constellation">
        {MEMBERS.map((member, index) => <MemberProfile key={member.id} member={member} index={index} />)}
      </div>
    </div>
  );
}
