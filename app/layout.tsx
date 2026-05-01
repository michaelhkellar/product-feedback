import type { Metadata } from "next";
import "./globals.css";
import { ErrorHandlers } from "@/components/error-handlers";

export const metadata: Metadata = {
  title: "Feedback Intelligence Agent",
  description:
    "AI-powered customer feedback intelligence — aggregate, analyze, and act on insights from Productboard, Attention, and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ErrorHandlers />
        {children}
      </body>
    </html>
  );
}
