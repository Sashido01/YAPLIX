/** Test-only oracle. Never imported by production or sent to browserCheck. */
export type CalibrationAction=string;
export const calibrationOracle=[
 {genre:'Snake',win:['right','right','right'],loss:['up','up','up'],progress:1,defects:['Movement is disconnected','Win target 30 exceeds the three available apples']},
 {genre:'Match three',win:['1','4'],loss:['0','1','0','1'],progress:3,defects:['Selection throws a runtime exception','Swap freezes the game in resolving']},
 {genre:'Collection',win:['right','right','right'],loss:['down'],progress:1,defects:['Collected item does not increment the goal','Restart is a no-op']},
 {genre:'Lane dodger',win:['left','step','right','step','step'],loss:['step'],progress:1,defects:['Health zero does not enter loss','Road collisions are disabled']},
 {genre:'Breakout',win:['step','step','step'],loss:['up',...Array<string>(7).fill('step')],progress:1,defects:['Hit brick stays in the world','Win target exceeds the single available brick']},
];
