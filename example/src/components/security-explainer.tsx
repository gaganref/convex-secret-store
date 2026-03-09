import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SecurityExplainerProps = {
  mode: "storage" | "usage";
};

const COPY = {
  storage: {
    title: "Read before storing",
    description:
      "This reference app keeps secret entry simple, but the storage boundary matters: values are encrypted, metadata is not.",
    items: [
      {
        label: "Secret value",
        detail:
          "Encrypted at rest, write-only in this UI, and never shown again after save.",
      },
      {
        label: "Metadata",
        detail:
          "Owner, label, and notes stay in plaintext. Do not put sensitive data there.",
      },
      {
        label: "Expiry",
        detail:
          "Expired rows are blocked from normal use and can be cleaned up later in batches.",
      },
      {
        label: "Rotation",
        detail:
          "Rotation rewraps key material only. It does not rewrite the secret plaintext.",
      },
    ],
  },
  usage: {
    title: "Read before consuming",
    description:
      "This tab demonstrates the server boundary. The browser asks for an operation; the server decides how the secret is used.",
    items: [
      {
        label: "Server load",
        detail:
          "The secret is resolved inside Convex actions or queries, not in the client app.",
      },
      {
        label: "Response shape",
        detail:
          "Return masked previews, status, or downstream API results instead of plaintext.",
      },
      {
        label: "Metadata",
        detail:
          "Ownership and labels can be returned because they are metadata, not encrypted value bytes.",
      },
      {
        label: "Client role",
        detail:
          "The browser chooses intent; the server owns secret use, expiry checks, and error handling.",
      },
    ],
  },
} as const;

export function SecurityExplainer({ mode }: SecurityExplainerProps) {
  const copy = COPY[mode];

  return (
    <Card size="sm">
      <CardHeader>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Explained
          </p>
          <CardTitle className="mt-0.5">{copy.title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <CardDescription>{copy.description}</CardDescription>
        <div className="grid gap-3 md:grid-cols-2">
          {copy.items.map((item) => (
            <div
              key={item.label}
              className="border border-border bg-muted/20 p-3"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 text-xs">{item.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
