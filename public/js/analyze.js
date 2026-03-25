// Image analysis — calls /api/analyze and renders a styled results card
import { els, state } from './state.js';
import { setChatEnabled, addTypingIndicator, removeTypingIndicator, addSystemMessage } from './ui.js';
import { getCanvasDataURL } from './canvas.js';
import { showCommandPreview } from './commands.js';

const { chatMessages, describeBtn } = els;

function createColorSwatch(color) {
  const swatch = document.createElement('span');
  swatch.className = 'analysis-color-swatch';
  swatch.style.backgroundColor = color.hex;
  swatch.title = `${color.name} (${color.hex}) — ${color.percentage}%`;
  return swatch;
}

function renderAnalysisCard(analysis) {
  const card = document.createElement('div');
  card.className = 'chat-msg assistant analysis-card';

  // Header
  const header = document.createElement('div');
  header.className = 'analysis-header';
  header.textContent = 'Image Analysis';
  card.appendChild(header);

  // Dominant colors
  if (analysis.dominantColors && analysis.dominantColors.length > 0) {
    const section = document.createElement('div');
    section.className = 'analysis-section';
    const label = document.createElement('div');
    label.className = 'analysis-label';
    label.textContent = 'Dominant Colors';
    section.appendChild(label);

    const swatches = document.createElement('div');
    swatches.className = 'analysis-colors';
    for (const color of analysis.dominantColors) {
      const item = document.createElement('div');
      item.className = 'analysis-color-item';
      item.appendChild(createColorSwatch(color));
      const info = document.createElement('span');
      info.className = 'analysis-color-info';
      info.textContent = `${color.name} ${color.hex} (${color.percentage}%)`;
      item.appendChild(info);
      swatches.appendChild(item);
    }
    section.appendChild(swatches);
    card.appendChild(section);
  }

  // Detected objects
  if (analysis.objects && analysis.objects.length > 0) {
    const section = document.createElement('div');
    section.className = 'analysis-section';
    const label = document.createElement('div');
    label.className = 'analysis-label';
    label.textContent = 'Detected Objects';
    section.appendChild(label);

    const tags = document.createElement('div');
    tags.className = 'analysis-tags';
    for (const obj of analysis.objects) {
      const tag = document.createElement('span');
      tag.className = 'analysis-tag';
      tag.textContent = obj;
      tags.appendChild(tag);
    }
    section.appendChild(tags);
    card.appendChild(section);
  }

  // Composition
  if (analysis.composition) {
    const section = document.createElement('div');
    section.className = 'analysis-section';
    const label = document.createElement('div');
    label.className = 'analysis-label';
    label.textContent = 'Composition';
    section.appendChild(label);

    const comp = analysis.composition;
    const detail = document.createElement('div');
    detail.className = 'analysis-detail';
    detail.innerHTML = `<strong>${comp.rule || 'N/A'}</strong> · ${comp.balance || 'N/A'}`;
    if (comp.notes) {
      const notes = document.createElement('div');
      notes.className = 'analysis-notes';
      notes.textContent = comp.notes;
      detail.appendChild(notes);
    }
    section.appendChild(detail);
    card.appendChild(section);
  }

  // Mood
  if (analysis.mood) {
    const section = document.createElement('div');
    section.className = 'analysis-section';
    const label = document.createElement('div');
    label.className = 'analysis-label';
    label.textContent = 'Mood';
    section.appendChild(label);
    const mood = document.createElement('div');
    mood.className = 'analysis-detail';
    mood.textContent = analysis.mood;
    section.appendChild(mood);
    card.appendChild(section);
  }

  // Suggested edits
  if (analysis.suggestedEdits && analysis.suggestedEdits.length > 0) {
    const section = document.createElement('div');
    section.className = 'analysis-section';
    const label = document.createElement('div');
    label.className = 'analysis-label';
    label.textContent = 'Suggested Edits';
    section.appendChild(label);

    const commands = analysis.suggestedEdits.map(edit => ({
      action: edit.action,
      ...edit.parameters,
    }));

    // Render each suggestion as text
    for (const edit of analysis.suggestedEdits) {
      const item = document.createElement('div');
      item.className = 'analysis-edit-item';
      item.innerHTML = `<strong>${edit.action}</strong> — ${edit.description}`;
      section.appendChild(item);
    }
    section.appendChild(document.createElement('div')); // spacer

    card.appendChild(section);

    // Add an Apply Suggestions button using the existing command preview system
    const applyBtn = document.createElement('button');
    applyBtn.className = 'analysis-apply-btn';
    applyBtn.textContent = 'Apply Suggested Edits';
    applyBtn.addEventListener('click', () => {
      applyBtn.remove();
      showCommandPreview(commands, card);
    });
    card.appendChild(applyBtn);
  }

  chatMessages.appendChild(card);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function describeImage() {
  const imageData = getCanvasDataURL();
  if (!imageData) {
    addSystemMessage('No image loaded. Upload an image first.');
    return;
  }

  setChatEnabled(false);
  describeBtn.disabled = true;
  addTypingIndicator();

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData }),
    });

    removeTypingIndicator();

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      addSystemMessage(data.error || 'Analysis failed. Please try again.');
      return;
    }

    const data = await res.json();
    if (data.analysis) {
      renderAnalysisCard(data.analysis);
    } else {
      addSystemMessage('Analysis returned no results.');
    }
  } catch (err) {
    removeTypingIndicator();
    addSystemMessage('Network error — could not analyze image.');
  } finally {
    setChatEnabled(true);
    describeBtn.disabled = false;
  }
}

describeBtn.addEventListener('click', describeImage);

export { describeImage };
