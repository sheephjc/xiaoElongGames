import { useState } from 'react';

export default function HomeScene({ imagePath = 'characters/character_girl_crocodile.png' }: { imagePath?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`home-scene${failed ? ' home-scene--fallback' : ''}`} aria-hidden="true">
      {!failed && (
        <img
          className="home-scene-image"
          src={`${import.meta.env.BASE_URL}${imagePath}`}
          alt=""
          draggable={false}
          decoding="async"
          loading="eager"
          onError={() => setFailed(true)}
        />
      )}
      <div className="home-scene-shade" />
    </div>
  );
}
