"use client";

import { useDocsSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import Link from "next/link";
import { useEffect } from "react";

const client = staticClient({ from: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/search-index.json` });

/** Where to go when a query matches nothing. */
const SUGGESTIONS = [
  { title: "Connect", href: "/docs/transports/" },
  { title: "Clients", href: "/docs/clients/" },
  { title: "Signing", href: "/docs/signing/" },
  { title: "Guides", href: "/docs/guides/" },
];

function SearchSkeleton() {
  return (
    <div className="search-skeleton" role="status" aria-label="Searching">
      <span />
      <span />
      <span />
    </div>
  );
}

function SearchEmpty({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="search-empty" role="status">
      <p>No matches. Try a method name, or start from a section:</p>
      <ul>
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion.href}>
            <Link href={suggestion.href} onClick={onNavigate}>
              {suggestion.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DocsSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({ client });

  // The static index (~800 KB) is fetched and parsed on first use. Start that when the dialog
  // opens, so it is usually ready by the first keystroke instead of stalling the first query.
  useEffect(() => {
    if (props.open) Promise.resolve(client.search("")).catch(() => {});
  }, [props.open]);

  // `query.data` stays "empty" until the first query resolves, and Fumadocs hides the list for
  // `null` items, so a pending first query would otherwise render nothing at all.
  const pending = search.length > 0 && (query.isLoading || query.data === "empty");
  const items = query.data !== "empty" ? query.data : pending ? [] : null;

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader className="search-header">
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList
          items={items}
          Empty={() => (pending ? <SearchSkeleton /> : <SearchEmpty onNavigate={() => props.onOpenChange(false)} />)}
        />
      </SearchDialogContent>
    </SearchDialog>
  );
}
