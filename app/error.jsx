"use client";
import {ErrorState} from '../components/studio/ui';
export default function Error({reset}){return <main id="main-content" className="landing-container py-16"><ErrorState message="This page could not finish loading. Your saved projects are still in your workspace." onRetry={reset}/></main>}
