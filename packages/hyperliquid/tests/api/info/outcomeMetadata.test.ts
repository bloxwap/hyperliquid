import { expect, test } from "bun:test";
import Ajv from "ajv";
import { typeToJsonSchema } from "../_utils/typeToJsonSchema.ts";

const outcomeSchema = typeToJsonSchema(
  new URL("../../../src/api/info/_methods/outcomeMeta.ts", import.meta.url).pathname,
  "OutcomeMetaResponse",
);
const settledSchema = typeToJsonSchema(
  new URL("../../../src/api/info/_methods/settledOutcome.ts", import.meta.url).pathname,
  "SettledOutcomeResponse",
);
const ajv = new Ajv({ strict: false });
const snapshots = [
  {
    deployers: [
      {
        deployer: "0x08e9c89f46dccee91bdb85c6532eb93a4c335efe",
        venue: "skew",
        subDeployers: [
          ["registerAndAssociateNamedOutcomeFromTemplate", ["0x1c867861e0cffb0eba07d9d94f716189c130dac6"]],
          ["registerQuestionFromTemplate", ["0x1c867861e0cffb0eba07d9d94f716189c130dac6"]],
          ["registerStandaloneOutcomeFromTemplate", ["0x1c867861e0cffb0eba07d9d94f716189c130dac6"]],
          ["settleOutcome", ["0x1c867861e0cffb0eba07d9d94f716189c130dac6"]],
          ["settleQuestion", ["0x1c867861e0cffb0eba07d9d94f716189c130dac6"]],
        ],
      },
      {
        deployer: "0x0c46eb73fae2816f219fcf11f50d6d3c59b5819e",
        venue: "out",
        subDeployers: [
          [
            "registerAndAssociateNamedOutcomeFromTemplate",
            [
              "0x6947a610ef50f8b5d4b59abcd94dd75aaaa645b9",
              "0xe5051ac5db90efacb1daffd43135dd477e5dbdab",
              "0xf1923927d7d2847191fb7ef8b1a16028aa5ae754",
            ],
          ],
          [
            "registerQuestionFromTemplate",
            [
              "0x6947a610ef50f8b5d4b59abcd94dd75aaaa645b9",
              "0xe5051ac5db90efacb1daffd43135dd477e5dbdab",
              "0xf1923927d7d2847191fb7ef8b1a16028aa5ae754",
            ],
          ],
          [
            "registerStandaloneOutcomeFromTemplate",
            [
              "0x6947a610ef50f8b5d4b59abcd94dd75aaaa645b9",
              "0xe5051ac5db90efacb1daffd43135dd477e5dbdab",
              "0xf1923927d7d2847191fb7ef8b1a16028aa5ae754",
            ],
          ],
          [
            "settleOutcome",
            [
              "0x6947a610ef50f8b5d4b59abcd94dd75aaaa645b9",
              "0xe5051ac5db90efacb1daffd43135dd477e5dbdab",
              "0xf1923927d7d2847191fb7ef8b1a16028aa5ae754",
            ],
          ],
          [
            "settleQuestion",
            [
              "0x6947a610ef50f8b5d4b59abcd94dd75aaaa645b9",
              "0xe5051ac5db90efacb1daffd43135dd477e5dbdab",
              "0xf1923927d7d2847191fb7ef8b1a16028aa5ae754",
            ],
          ],
        ],
      },
    ],
    feeScale: "1.0",
    outcomes: [
      {
        outcome: 6611,
        name: "Recurring",
        description: "class:priceBinary|underlying:BTC|expiry:20260930-0600|targetPrice:83397|period:1d",
        sideSpecs: [
          {
            name: "Yes",
          },
          {
            name: "No",
          },
        ],
        quoteToken: "USDC",
      },
      {
        outcome: 1209,
        name: "template:priceTouch",
        description: "perp:HYPE|priceDescription:HYPE-USDC perp mark |seconds:1|target:100|time:20261001-0000",
        sideSpecs: [
          {
            name: "template:Yes",
          },
          {
            name: "template:No",
          },
        ],
        quoteToken: "USDC",
        venue: "out",
        deployerFeeScale: "1.0",
      },
    ],
    questions: [
      {
        question: 198,
        name: "template:sportsTournamentWinner",
        description:
          "competition:English Premier League|officialSource:English Premier League|resolutionDeadline:20270605-1200|season:2026/2027|sport:football/soccer",
        fallbackOutcome: 1472,
        namedOutcomes: [1473, 1474, 1475, 1476, 1477, 1478],
        settledNamedOutcomes: [],
      },
    ],
  },
  {
    deployers: [
      {
        deployer: "0x000000000670de987688f215796a06ee3bd94985",
        venue: "cat",
        subDeployers: [],
      },
      {
        deployer: "0x027fdb5a1fd15ba589ea481b186bf9c445a3972a",
        venue: "dfq",
        subDeployers: [
          ["registerStandaloneOutcomeFromTemplate", ["0x512b76bd255359459b1a8d58745b2d36726f1209"]],
          ["settleOutcome", ["0x512b76bd255359459b1a8d58745b2d36726f1209"]],
        ],
      },
    ],
    feeScale: "1.0",
    outcomes: [
      {
        outcome: 10217,
        name: "Fallback",
        description: "",
        sideSpecs: [
          {
            name: "Yes",
          },
          {
            name: "No",
          },
        ],
        quoteToken: "USDC",
      },
      {
        outcome: 11010,
        name: "template:binaryPrice",
        description: "perp:BTC|threshold:100|time:20260901-1200",
        sideSpecs: [
          {
            name: "template:Yes",
          },
          {
            name: "template:No",
          },
        ],
        quoteToken: "USDC",
        venue: "ag",
      },
    ],
    questions: [
      {
        question: 820,
        name: "May CPI year-over-year",
        description:
          "The question resolves by assigning Yes to exactly one of Below 4.3%, Exactly 4.3%, or Above 4.3% based on the Bureau of Labor Statistics Consumer Price Index news release for May 2026, currently scheduled for June 10, 2026 at 8:30 AM ET. The relevant value is the non-seasonally adjusted all items Consumer Price Index for All Urban Consumers (CPI-U) percent change over the 12 months ending May 2026, as reported to one decimal place in the official monthly CPI news release. If BLS has not published the May 2026 all items CPI-U figure by July 15, 2026, or if BLS announces that it will not publish the May 2026 all items CPI-U figure, the question instead resolves to the most recently published month's non-seasonally adjusted all items CPI-U 12-month percent change available at that time. If the May 2026 release occurs on a date other than the scheduled date, the rescheduled release is still used for resolution, provided the figure is published by July 15, 2026. Resolution uses the initial published value, not subsequent revisions.",
        fallbackOutcome: 10217,
        namedOutcomes: [10218, 10219, 10220],
        settledNamedOutcomes: [],
      },
    ],
  },
];
const settlement = {
  spec: {
    outcome: 12568,
    name: "template:sportsContestParticipant",
    description: "participant:Arsenal",
    sideSpecs: [
      {
        name: "Yes",
      },
      {
        name: "No",
      },
    ],
    quoteToken: "USDC",
    venue: "mig",
    deployerFeeScale: "1.0",
  },
  settleFraction: "0.0",
  details: "template",
  question: {
    question: {
      active: 979,
    },
    name: "template:sportsContestResult",
    description:
      "competition:UEFA Champions League|contestType:match|officialSource:UEFA|participantA:Arsenal|participantB:Chelsea|resolutionDeadline:20260829-0428|scheduledStart:20260829-0328|season:2026/27|sport:football|stage:Matchday",
  },
};

test("HIP-4 mainnet/testnet venue, deployer permissions and fee metadata validate", () => {
  const validate = ajv.compile(outcomeSchema);
  for (const snapshot of snapshots) expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ outcomes: snapshots[0].outcomes.filter((x) => !("venue" in x)), questions: [] })).toBe(true);
});
test("settled outcomes preserve the template venue and fee scale", () => {
  const validate = ajv.compile(settledSchema);
  expect(validate(settlement), JSON.stringify(validate.errors)).toBe(true);
  expect(validate(null)).toBe(true);
});
