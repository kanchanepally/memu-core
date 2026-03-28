# Memu: Path to 50 Paying Families
## A Practical Validation Guide

**Where you are:** Spec v3 is done. Z2 is running. Family uses the existing stack lightly. The gateway (Slice 1) hasn't been built yet.

**Where you need to be:** 50 families paying £8/month for Memu Cloud. That's £400/month recurring revenue, proving the unit economics work and the product has real demand.

**Timeline:** 12-16 weeks from today.

---

## Phase 0: Build the Thing (Weeks 1-4)

Nothing else matters until Memu works on your family's WhatsApp. No marketing, no Substack posts, no Reddit. Build first.

### Week 1-2: Slice 1 (Gateway + Twin)

Build on the Z2. Baileys connection with Memu's own WhatsApp number. Twin translation with your family's configured entities. Claude API routing. PostgreSQL context store. Basic message storage.

**The test:** You text Memu from WhatsApp. It responds. Your name doesn't appear in the Claude API call. Your wife texts Memu. Her conversation is separate from yours.

### Week 3: Slice 2 (Profiles + Child Safety)

Robin's profile. Age-appropriate responses via Haiku. Parent dashboard showing his conversations. Your wife's private adult profile via Sonnet.

**The test:** Robin prefers Memu to asking you. Your wife uses it unprompted. You check the dashboard and trust what you see.

### Week 4: Slice 3 (Observation + Morning Briefing)

WhatsApp group observer. Google Calendar observer. Morning briefing at 7am to the family group.

**The test:** Someone in the family acts on the morning briefing. Your wife asks "what's on this week?" and Memu answers correctly from the calendar.

**DO NOT PROCEED TO PHASE 1 UNTIL YOUR WIFE SAYS "THIS IS ACTUALLY USEFUL."**

That's not a joke. It's the single most important validation gate. If the person in your household who didn't build this, doesn't care about the technology, and has better things to do than test your side project — if *she* says it's useful — you have a product. If she doesn't, iterate until she does.

---

## Phase 1: Three Beta Families (Weeks 5-8)

### Who to pick

You need three families who are NOT you. Pick from:

1. **Your friend who asked about WhatsApp.** He's already interested. He's your first call.
2. **A parent from school.** Someone you know personally, who you've heard complain about the juggle of school emails, WhatsApp groups, and calendar chaos. Not a tech person — a normal parent.
3. **A tech-adjacent colleague.** Someone from work or your network who understands technology but doesn't self-host. They'll give you useful feedback on the setup experience.

### How to onboard them

You set up Memu Cloud for them. Not on their hardware — on a Hetzner VPS you manage. Their experience is:

1. You send them a link: "I'm building something for families. Can I set it up for yours? 10 minutes of your time."
2. You call them, share your screen, walk them through the setup wizard.
3. They scan a QR code on their phone.
4. They add Memu as a WhatsApp contact.
5. They text Memu. It responds.
6. You add their family members' profiles together.
7. Done.

**Your cost:** ~£8/month for one Hetzner CPX22 running all three beta families + your API costs (~£5-10/month total for three families). Budget £20/month for the beta phase.

### What to watch for

Don't ask them what they think. Watch what they *do*.

After one week, check:
- How many messages did each family member send? (If zero after day 3, it's not working.)
- Did anyone use the morning briefing? (If they muted the group, the briefing format needs work.)
- What did they ask Memu about? (This tells you the real use cases, not the ones you assumed.)
- Did any family member other than the person you onboarded actually use it? (If only the "tech person" in the family uses it, you have a single-user product, not a family product.)

After two weeks, ask three questions:
1. "If I took Memu away tomorrow, would you miss it?"
2. "Would you pay £8/month for this?"
3. "Who else would you tell about this?"

If two out of three families say yes to all three: proceed to Phase 2. If not: iterate. Ask them what's missing. Fix it. Ask again.

---

## Phase 2: The Substack Arc (Weeks 5-10, parallel with beta)

You write about what you're experiencing — not what you're building. The Substack is your demand generation engine. It runs in parallel with the beta, not after it.

### Post 1: "I Added an AI to My Family's WhatsApp"

This is your launch post. It tells the story: the school closure that no one connected the dots on, the realisation that your family needs a Chief of Staff, the decision to build one, and what happened when your family started using it.

Include the birthday present example from the spec (the paddleboarding gift). Include a screenshot of a real morning briefing (with names redacted). Include the one-line pitch: "Memu is a WhatsApp contact that knows your family's life. The AI never learns your name."

End with: "We're opening Memu to a small number of families. If this sounds like something your household needs, join the waitlist."

Link to a simple Tally form: name, email, "how many people in your household?", "what messaging app does your family use?"

**Target:** 50-100 waitlist signups from this post.

### Post 2: "What Happened When My Son Talked to AI (And I Could See Everything)"

The child safety angle. The MyDigitAlly educational framework. The parent dashboard. The PII stripping in action — show the before/after of a child's message.

This post will resonate with parents who are anxious about their kids using ChatGPT unsupervised. It's not fear-based — it's empowering. "I gave my son access to AI. I set the rules. I can see what he asks. And the AI never learned his name."

**Target:** This post gets shared in parenting groups. Cross-post a summary to relevant Reddit communities (r/parenting, r/digitalparenting if it exists, r/privacy).

### Post 3: "The Architecture of Family Privacy"

The technical post. The Anonymous Family Digital Twin. The translation (not stripping) approach. The three trust levels. The ephemeral RAM processing honesty.

This is the post for Hacker News, r/selfhosted, r/privacy, and the tech audience. It's also the post that establishes your credibility — you're not hand-waving about privacy, you're explaining the exact architecture and being honest about its limits.

**Target:** Technical credibility. GitHub stars. Developer interest. Potential contributors.

### Post 4: "A Beta Family's First Week"

With permission from one of your beta families, tell their story. What they hoped for, what surprised them, what frustrated them, what they now use daily. Real quotes.

**Target:** Social proof. This is the post that converts waitlist subscribers into "I'm ready to pay" signals.

### Post 5: "We're Opening Memu Cloud"

The launch post. Pricing (£8/month). What you get. How to sign up. First 50 families get a founding member rate (£5/month, locked for life). The waitlist becomes the launch list.

---

## Phase 3: Convert Waitlist to Paying Families (Weeks 10-14)

### The launch email sequence

**Email 1 (to full waitlist): "Memu Cloud is live."**

Short. Direct. Link to sign up. Founding member pricing for the first 50.

**Email 2 (3 days later, to non-converters): "Here's what a Memu morning looks like."**

Show a real morning briefing. Show a real conversation. Make them feel what they're missing.

**Email 3 (1 week later, to non-converters): "Your family's data question."**

The privacy angle. Not fear — empowerment. "Every time your child asks ChatGPT a question, OpenAI stores it. With Memu, the AI never learns your child's name." Link to the architecture post.

### Where else the signups come from

**Your LinkedIn.** You're a Technology Portfolio Director at a major publisher. You have a professional network of people who understand technology, have families, and have disposable income. Write 2-3 LinkedIn posts about the founder journey — not selling Memu, but sharing the story. "I built a family AI in my kitchen. Here's what I learned." People who resonate will find the Substack. The Substack converts to the waitlist. The waitlist converts to signups.

**Reddit.** One high-quality post on r/selfhosted showing the architecture. One on r/privacy showing the twin translation approach. One on r/parenting or r/daddit showing the child safety angle. Each post should be genuinely valuable on its own (not "check out my product") with Memu as the practical example. Comments will ask for a link. You provide the waitlist.

**Word of mouth from beta families.** If your beta families love it, each one tells 2-3 friends. That's 6-9 warm leads who heard about Memu from someone they trust. Those convert at a much higher rate than cold traffic.

**Your school community.** You're a parent at your kids' school. Other parents have the same chaos — the WhatsApp groups, the missed emails, the schedule juggling. One conversation at the school gate: "I built something that reads the school emails and tells me what's important each morning. Want to try it?" That's a more powerful sales channel than any Reddit post.

**MyDigitAlly newsletter.** Your existing subscribers are parents interested in their kids' digital lives. A mention of Memu — "I've been building something that lets my son use AI safely, and I'd love your feedback" — reaches an audience that's already self-selected for the problem you solve.

---

## The Milestones

| Week | Milestone | Evidence |
|---|---|---|
| 4 | Memu works for your family | Wife says "this is useful" |
| 6 | 3 beta families onboarded | All families have active users beyond the person you set it up for |
| 8 | Beta families validated | 2/3 would pay, 2/3 would miss it if removed |
| 8 | Substack Post 1 published | 50+ waitlist signups |
| 10 | Posts 2-3 published | 150+ total waitlist, Reddit/HN engagement |
| 12 | Memu Cloud live | Signup flow works, Stripe connected, first paying family |
| 14 | 50 paying families | £400/month recurring revenue |

---

## What You Don't Do

**Don't build the PWA yet.** WhatsApp is the interface. The parent dashboard is a web page. That's enough for 50 families.

**Don't build Tier 2/3 packaging yet.** You run Tier 2 for your own family. Beta families run on your Hetzner VPS. Self-hosted packaging comes after you've validated demand on cloud.

**Don't do a Kickstarter.** The original plan was a hardware Kickstarter. The v3 spec changed the entry point to cloud-first. A Kickstarter for a SaaS subscription doesn't make sense. Instead, the founding member pricing (£5/month locked forever for the first 50) creates the same urgency without the Kickstarter overhead.

**Don't spend money on ads.** At this stage, every customer should come from content (Substack), community (Reddit/LinkedIn), or referral (beta families, school gate, MyDigitAlly). If you can't get 50 families without paid acquisition, the product or the messaging needs work — ads won't fix that.

**Don't write code for features nobody asked for.** After the core slices (1-3), every new feature should come from beta family feedback. If nobody asks for email observation, don't build it. If three families ask for a shopping list, build it next. Let demand drive the roadmap.

---

## The One Thing That Matters Most

The entire validation plan rests on one moment: the first time someone who isn't you, who didn't build this, who has their own busy family life, texts Memu from WhatsApp and says to their partner: "Have you tried this? It's actually good."

That's the moment. Everything else — the Substack, the waitlist, the pricing, the cloud infrastructure — is scaffolding to create the conditions for that moment to happen, and to capture the demand it generates.

Build the thing. Let your family use it. Let three other families use it. Write about what happens. The 50 families will come from the story, not the marketing.

---

*"The best product validation is when your customer tells someone else about it without you asking."*
