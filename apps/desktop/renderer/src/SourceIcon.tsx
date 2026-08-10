import {useState} from 'react';
import {Rss} from 'lucide-react';

export function SourceIcon({sourceId, name, size = 18}: {sourceId: string; name: string; size?: number}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Rss size={size} aria-hidden="true"/>;
  return <img className="source-favicon" src={`rss-reader-favicon://source/${sourceId}`}
              alt="" width={size} height={size} onError={() => setFailed(true)}/>;
}
