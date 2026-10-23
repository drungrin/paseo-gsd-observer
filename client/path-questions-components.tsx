import { Text, View } from "react-native";
import type { PathQuestion } from "../shared/path.js";
import type { BoardViewState } from "./board-components.js";
import { Badge, Card, Count, PATH_WARNING_COPY, PathFrame, SetupNotice, smallStyle, textStyle, tokenLabel, type ThemeProps } from "./path-components.js";

const statusLabel = (status: string | null) => status === "needs-user" ? "Needs user" : tokenLabel(status);

function QuestionCard({ question, theme }: ThemeProps & { question: PathQuestion }) {
  return <Card title={`${question.id}${question.topic ? ` · ${question.topic}` : ""}`} source={question.date ? `Answered ${question.date}` : undefined} theme={theme} attention={question.status === "needs-user"}>
    <Text style={textStyle(theme)}>{question.question ?? "The question is not safely displayable."}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
      <Badge label={statusLabel(question.status)} theme={theme} attention={question.status === "needs-user"} />
      {question.owner && <Badge label={`Next owner: ${question.owner}`} theme={theme} />}
    </View>
    {question.target && <Text style={smallStyle(theme)}>Target artifact: {question.target}</Text>}
  </Card>;
}

export function PathQuestionsView({ state, onRefresh, theme, compact = false }: ThemeProps & { state: BoardViewState; onRefresh(): void; compact?: boolean }) {
  const path = state.snapshot?.path;
  const questions = path?.questions;
  const warnings = path?.warnings.filter((warning) => warning.startsWith("questions-")) ?? [];
  return <PathFrame title="Questions" description="Discussion answers that still need a follow-up, from discuss/ANSWERS.md." subject="questions" state={state} onRefresh={onRefresh} theme={theme} compact={compact}>
    {!path ? <SetupNotice setup="unavailable" theme={theme} /> : path.setup !== "started" ? <SetupNotice setup={path.setup} theme={theme} /> : questions?.availability === "available" ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Count label="Pending follow-ups" value={questions.counts.pending} theme={theme} attention={questions.counts.pending > 0} />
        <Count label="Answers recorded" value={questions.counts.answers} theme={theme} />
        <Count label="Closed by a disposition or a later answer" value={questions.counts.closed} theme={theme} />
      </View>
      <Text style={smallStyle(theme)}>An answer is pending while its follow-up is required, its status is final or NEEDS-USER, and no disposition or later answer closes it.</Text>
      {questions.limited && <Text role="alert" style={textStyle(theme, true)}>More pending answers exist than can be shown.</Text>}
      {warnings.map((warning) => <Text key={warning} style={smallStyle(theme)}>{PATH_WARNING_COPY[warning]}</Text>)}
      {questions.pending.length ? questions.pending.map((question) => <QuestionCard key={question.id} question={question} theme={theme} />)
        : <Card title="No pending follow-ups" theme={theme}><Text style={textStyle(theme, true)}>Every recorded answer is closed or needs no follow-up.</Text></Card>}
    </> : <Card title={questions?.availability === "absent" ? "No discussion recorded" : "Questions unavailable"} theme={theme}>
      <Text style={textStyle(theme, true)}>{questions?.availability === "absent" ? "GSD Path writes discuss/ANSWERS.md when a discussion records an answer." : "The discussion answers file could not be read safely."}</Text>
    </Card>}
  </PathFrame>;
}
