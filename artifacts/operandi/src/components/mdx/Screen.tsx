import { useState } from "react";

export function Screen({ src, caption, hideCaptionIfEmpty = false }: { src: string; caption?: string; hideCaptionIfEmpty?: boolean }) {
  const [error, setError] = useState(false);

  return (
    <figure className="my-12 w-full not-prose">
      <div className="border hairline bg-paper rounded-sm overflow-hidden flex items-center justify-center min-h-[300px] md:min-h-[500px]">
        {!error ? (
          <img 
            src={src} 
            alt={caption || "Product screenshot"} 
            className="w-full h-auto"
            onError={() => setError(true)}
          />
        ) : (
          <div className="text-faint text-sm uppercase tracking-wider">
            Image not provided ({src})
          </div>
        )}
      </div>
      {(!hideCaptionIfEmpty || caption) && caption && (
        <figcaption className="mt-4 text-[14px] text-muted text-center italic">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
