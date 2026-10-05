import {AudioLines} from 'lucide-react';

export default function Brand({href='/',small=false}) {
  return <a href={href} className="wordmark" aria-label="Alpha.ai home"><AudioLines size={small?19:25} strokeWidth={2.3}/><span>alpha<span className="text-muted">.ai</span></span></a>;
}
