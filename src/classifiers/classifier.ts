import { ConversationMessage, TemplateVariables } from "../types";

import { Agent } from "../agents/agent";

export interface ClassifierResult {
  // The agent selected by the classifier to handle the user's request
  selectedAgent: Agent | null;

  // A numeric value representing the classifier's confidence in its selection
  // Typically a value between 0 and 1, where 1 represents 100% confidence
  confidence: number;
}

/**
 * Abstract base class for all classifiers
 */
export abstract class Classifier {
  protected modelId: string;
  protected agentDescriptions: string;
  protected agents: { [key: string]: Agent };
  protected history: string;
  protected promptTemplate: string;
  protected systemPrompt: string;
  protected customVariables: TemplateVariables;

  /**
   * Constructs a new Classifier instance.
   * @param options - Configuration options for the agent, inherited from AgentOptions.
   */
  constructor() {
    this.agentDescriptions = "";
    this.history = "";
    this.customVariables = {};
    this.promptTemplate = `
You are AgentMatcher, an intelligent assistant designed to analyze user queries and match them with the most suitable agent or department. Your task is to understand the user's request, identify key entities and intents, and determine which agent or department would be best equipped to handle the query.

Analyze the user's input and history and categorize it into one of the following agent types:
<agents>
{{AGENT_DESCRIPTIONS}}
</agents>

Guidelines for classification:

    Agent Type: Select the most appropriate agent type from the following agent list, depending on the nature of the request. The following agent list of agents may change, keep an eye on it. If the previous agent has disappeared from the following agent list, then you need to classify the agent that is on the following agent list.
    Priority: Assign based on urgency and impact.
        High: Issues affecting service, billing problems, or urgent technical issues
        Medium: Non-urgent product inquiries, sales questions
        Low: General information requests, feedback
    Key Entities: Extract important nouns, product names, or specific issues mentioned. For follow-up responses, include relevant entities from the previous interaction if applicable.
    For follow-ups, relate the intent to the ongoing conversation.
    Confidence: Indicate how confident you are in the classification.
        High: Clear, straightforward requests or clear follow-ups
        Medium: Requests with some ambiguity but likely classification
        Low: Vague or multi-faceted requests that could fit multiple categories
    Is Followup: Indicate whether the input is a follow-up to a previous interaction.

Handle variations in user input, including different phrasings, synonyms, and potential spelling errors. For short responses like "yes", "ok", "I want to know more", or numerical answers, treat them as follow-ups and maintain the previous agent selection.

Here is the conversation history that you need to take into account before answering:
<history>
{{HISTORY}}
</history>

Skip any preamble and provide only the response in the specified format.
`;
  }

  setAgentDescriptions(context?: any) {
    const agentDescriptions = Object.entries(this.agents)
      .filter(([_key, agent]) => {
        if (agent?.blocked && context) {
          for (const key in agent.blocked) {
            if (context[key]) {
              return false;
            }
          }
        }

        return true;
      })
      .map(([_key, agent]) => `${agent.id}:${agent.description}`);

    this.agentDescriptions = agentDescriptions.join("\n\n");
  }

  setAgents(agents: { [key: string]: Agent }) {
    this.agents = agents;
    this.setAgentDescriptions();
  }

  setHistory(messages: ConversationMessage[]): void {
    this.history = this.formatMessages(messages);
  }

  setSystemPrompt(template?: string, variables?: TemplateVariables): void {
    if (template) {
      this.promptTemplate = template;
    }

    if (variables) {
      this.customVariables = variables;
    }

    this.updateSystemPrompt();
  }

  private formatMessages(messages: ConversationMessage[]): string {
    return messages
      .map(message => {
        const texts = message.content.map(content => content.text).join(" ");
        return `${message.role}: ${texts}`;
      })
      .join("\n");
  }

  /**
   * Classifies the input text based on the provided chat history.
   *
   * This method orchestrates the classification process by:
   * 1. Setting the chat history.
   * 2. Updating the system prompt with the latest history, agent descriptions, and custom variables.
   * 3. Delegating the actual processing to the abstract `processRequest` method.
   *
   * @param inputText - The text to be classified.
   * @param chatHistory - An array of ConversationMessage objects representing the chat history.
   * @returns A Promise that resolves to a ClassifierResult object containing the classification outcome.
   */
  async classify(
    inputText: string,
    chatHistory: ConversationMessage[],
    context?: any
  ): Promise<ClassifierResult> {
    // Set the chat history
    this.setHistory(chatHistory);
    // Update the system prompt with the latest history, agent descriptions, and custom variables
    this.updateSystemPrompt(context);
    return await this.processRequest(inputText, chatHistory);
  }

  /**
   * Abstract method to process a request.
   * This method must be implemented by all concrete agent classes.
   *
   * @param inputText - The user input as a string.
   * @param chatHistory - An array of Message objects representing the conversation history.
   * @returns A Promise that resolves to a ClassifierResult object containing the classification outcome.
   */
  abstract processRequest(
    inputText: string,
    chatHistory: ConversationMessage[]
  ): Promise<ClassifierResult>;

  private updateSystemPrompt(context?: any): void {
    // изменять agentDescriptions в зависимости от context
    this.setAgentDescriptions(context);

    const allVariables: TemplateVariables = {
      ...this.customVariables,
      AGENT_DESCRIPTIONS: this.agentDescriptions,
      HISTORY: this.history,
    };

    this.systemPrompt = this.replaceplaceholders(
      this.promptTemplate,
      allVariables
    );

    console.log("this.systemPrompt", this.systemPrompt);
  }

  private replaceplaceholders(
    template: string,
    variables: TemplateVariables
  ): string {
    return template.replace(/{{(\w+)}}/g, (match, key) => {
      if (key in variables) {
        const value = variables[key];
        if (Array.isArray(value)) {
          return value.join("\n");
        }
        return value;
      }
      return match; // If no replacement found, leave the placeholder as is
    });
  }

  protected getAgentById(agentId: string): Agent | null {
    if (!agentId) {
      return null;
    }

    const myAgentId = agentId.split(" ")[0].toLowerCase();
    const matchedAgent = this.agents[myAgentId];

    return matchedAgent || null;
  }
}
