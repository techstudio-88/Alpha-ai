import "./globals.css";

export const metadata = {
  title: "Alpha.ai — Turn Long Videos Into Content That Gets Watched.",
  description: "AI clipping, captions, smart reframe, editing and publishing in one workspace.",
  verification: {
    google: "aUXmuhH0cn1r-DK266HUz1XYbPvrhk82-gY2sFEOR1c",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
