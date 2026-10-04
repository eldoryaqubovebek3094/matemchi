// Level and mode configuration
const Config = {
  modes: {
    addsub: {
      label: 'Qo‘shish/Ayirish',
      levels: [
        { range: [0, 10], ops: ['+','-'], visual: 'dots' },
        { range: [0, 20], ops: ['+','-'], visual: 'dots' },
        { range: [0, 50], ops: ['+','-'], visual: 'none' },
      ],
    },
    multdiv: {
      label: 'Ko‘paytirish/Bo‘lish',
      levels: [
        { range: [2, 9], ops: ['×','÷'], visual: 'array' },
        { range: [2, 12], ops: ['×','÷'], visual: 'array' },
        { range: [2, 15], ops: ['×','÷'], visual: 'none' },
      ],
    },
  },
  session: {
    questionsPerLevel: 10,
    baseScore: 10,
    streakBonus: 2,
  },
};

if (typeof window !== 'undefined') window.Config = Config;
