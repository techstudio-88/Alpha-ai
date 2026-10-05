import {Suspense} from 'react';
import StudioApp from '../../components/studio/studio-app';
import {ScreenSkeleton} from '../../components/studio/ui';
export const metadata={title:'Studio',robots:{index:false,follow:false}};
export default function Page(){return <Suspense fallback={<main id="main-content" className="studio-content"><ScreenSkeleton/></main>}><StudioApp/></Suspense>}
