import {MarketingNav,MarketingFooter,PricingCards} from '../../components/studio/marketing';
export const metadata={title:'Pricing',alternates:{canonical:'/pricing'}};
export default function Page(){return <><MarketingNav/><main id="main-content" className="landing-container landing-section"><div className="section-heading"><span className="eyebrow">ALPHA.AI PRICING</span><h1 className="text-4xl mt-4">Start with one recording.</h1><p className="mt-4">Current pilot access and a transparent preview of planned paid tiers.</p></div><PricingCards/></main><MarketingFooter/></>}
