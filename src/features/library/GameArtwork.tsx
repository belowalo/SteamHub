import { useState } from "react";
import { Gamepad2 } from "lucide-react";

export function GameArtwork({
  appId,
  thumbnail = false,
}: {
  appId: string;
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const sources = /^[1-9]\d*$/.test(appId)
    ? [
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        `https://shared.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      ]
    : [];
  const source = sources.find((url) => !failed.includes(url));
  return (
    <span
      className={
        thumbnail ? "library-artwork library-artwork-thumb" : "library-artwork"
      }
    >
      <Gamepad2 aria-hidden="true" />
      {source && (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() =>
            setFailed((previous) =>
              previous.includes(source) ? previous : [...previous, source],
            )
          }
        />
      )}
    </span>
  );
}
