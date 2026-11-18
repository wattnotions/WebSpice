/**
 * Vendor subcircuit models, converted to ngspice. GENERATED FILE - do not edit by hand.
 *
 * Regenerate with:
 *   pnpm models:import
 */

import type { SubcircuitModel } from './component-library';

export const SUBCIRCUIT_MODELS: Record<string, SubcircuitModel> = {
	"CSD17382F4": {
		name: "CSD17382F4",
		kind: "nmos",
		pins: ["D","G","S"],
		description: "Texas Instruments CSD17382F4: 30 V N-channel FemtoFET MOSFET, logic level (specified down to VGS = 1.8 V)",
		source: "static/SpiceModels/CSD17382F4/CSD17382F4.lib",
		text: "* PSpice Model Editor - Version 16.2.0\n*$\n* CSD17382F4\n***********************************************************************\n*  (C) Copyright 2020 Texas Instruments Incorporated. All rights reserved.\n* TI Information - Selective Disclosure to Poly\n***********************************************************************\n***********************************************************************\n** This model is designed as an aid for customers of Texas Instruments.\n** TI and its licensors and suppliers make no warranties, either expressed\n** or implied, with respect to this model, including the warranties of\n** merchantability or fitness for a particular purpose. The model is\n** provided solely on an \"as is\" basis. The entire risk as to its quality\n** and performance is with the customer\n********************************************************************************\n*\n********************************************************************************\n*\n* Released by: Texas Instruments Inc.\n* Part: CSD17382F4\n* Date: 02/13/2020\n* Model Type: TRANSIENT\n* Simulator: PSPICE\n* Simulator Version: 16.2\n* EVM Order Number: \n* EVM Users Guide: \n* Datasheet: SLPS562A ? APRIL 2016 ? REVISED DECEMBER 2016\n* Model Version: Final 1.00\n*\n*****************************************************************************\n\n**********************************************************************\n**********************************************************************\n*                                                                    *\n* CSD17382F4   -  PSpice Model for use with OrCAD                    *\n*                                                                    *\n**********************************************************************\n**********************************************************************\n* Characteristics:\n*   Technology:   NCH 12/10\n*\n**********************************************************************\n* Model History:\n*   tr, 4/7/2016\n*    \n**********************************************************************\n* SUBCKT Definition:  1=D  2=G  3=S\n.SUBCKT CSD17382F4  1 2 3\n* PARAMETER (local) DEFINITIONS SECTION\n .param AAN13383=0.66\n .param AAN83325=1.58\n .PARAM ptrc1=2.75e-3\n .PARAM ptrc2=-01.00e-6\n .PARAM pwidthP={AAN13383/0.8*2}\n .PARAM pwidth={pwidthP*1e6}\n .PARAM perimP={2.1*pwidthP}\n .PARAM perim={perimP*1e6}\n****** MODEL SUBCIRCUIT BEGINS HERE     ******************************\nM1\t11\t5\t6\t6\tNMOS\tW={pwidthP} L=0.5u  PS={perimP} PD={perimP}\nRGG\t\t2\t22\t110\nRGG2\t22\t5\t110\n*cgs0\t5\t22\t1.60e-12\tic=0\nDDG1  \t1\t101\tDD area={AAN13383/AAN83325}\nDDG2  \t5\t101\tDD area={AAN13383/AAN83325}\nDBD\t\t3\t1\tDBD area={AAN13383/AAN83325}\nCBD0  \t1  \t3   3e-12\nRBD0  \t1  \t3   1e10\nRSP   \t6\t3\t0.15e-3\nRDD 1 11 54.00e-3 tc1={ptrc1} tc2={ptrc2}\nDESD1\t2\t30\tDDZ\nDESD2\t3\t30\tDDZ\n******************************************************************* \n.MODEL  NMOS   NMOS (\n* CONTROL PARAMETERS\n+ LEVEL  = 8             VERSION = 3.2         CAPMOD = 2\n* DC PARAMETERS\n+ NLX    = 1.74E-7       VBM    = -5           DVT0   = 2.2\n+ DVT1   = 0.53          DVT2   = -0.032       U0     = 400\n+ UA     = 8.0e-9        UB     = 0.0e-19      A0     = 0.9\n+ AGS    = 0.0           A1     = 0.0          A2     = 0.9\n+ LINT   = 0.055e-6      VOFF   = -0.30        NFACTOR= 1.7\n+ ETA0   = 0.005         ETAB   = -0.07        DSUB   = 1.4\n+ PCLM   = 3.00          PDIBLC1= 0.02         PDIBLC2= 0.004\n+ DROUT  = 0.90          PSCBE1 = 3.0e8        PSCBE2 = 1e-6\n+ PVAG   = 0.1           DELTA  = 0.0220       JS     = 0\n* AC AND CAPACITANCE PARAMETERS\n+ CGSO   = 1.00e-18\t\tCGDO   = 1e-18        CGBO   = 1e-18\n+ CJ     = 1e-18        CJSW   = 1e-18        CF     = 0\n* TEMPERATURE PARAMETERS\n+ TNOM   = 25            UTE    = -1.5         KT1    = -0.70\n+ KT1L   = 1.0e-15       KT2    = 0.022        UA1    = -01.00e-9\n+ UB1    = 5.0e-17      \n* PROCESS PARAMETERS\n+ TOX    = 2.50e-8       XJ     = 3e-7          NCH    = 1.250e17\n+ NSUB   = 1.0e16)\n******************************************************************* \n.MODEL  PMOSd   PMOS (   LEVEL  = 1\n+ TNOM   = 25            VTO    = -1.0          IS     = 6.0e-14\n+ TOX    = 3.0e-8        NSUB   = 2.0e17\t\tGAMMA  = 15\n+ CJ     = 1e-18         CJSW   = 1e-18\n+ CGSO   = 1e-18         CGDO   = 1e-18         CGBO   = 0  )\n*******************************************************************\n.MODEL DBD D (CJO=2.50e-10 VJ=0.5 M=0.5 TNOM=25\n+ FC=0.5 TT=2e-09 XTI=-1.0 BV=31.00\n+ IS=3.0e-11 N=1.07 RS=1.625e-2 TRS1=4.0e-3)\n*******************************************************************\n.MODEL DD  D (CJO=5.00e-010 VJ=0.40 M=0.70 IS=1e-13 RS=0.1 TNOM=25)\n*******************************************************************\n.MODEL DDZ D (CJO=1e-18 VJ=0.9 M=0.9 IS=1e-13 RS=1.0e+1 TNOM=25 bv=12.1)\n*******************************************************************\n*******************************************************************\n.ENDS CSD17382F4  \n*$\n",
		datasheet: {
			"part": "CSD17382F4",
			"manufacturer": "Texas Instruments",
			"description": "30 V N-channel FemtoFET MOSFET, logic level (specified down to VGS = 1.8 V)",
			"datasheet": {
				"url": "https://www.ti.com/lit/ds/symlink/csd17382f4.pdf",
				"document": "SLPS562C",
				"revised": "2022-02"
			},
			"package": {
				"name": "Femto (0402) 1.0 mm x 0.6 mm SMD leadless",
				"size_mm": [
					1,
					0.6,
					0.36
				],
				"pins": [
					"D",
					"G",
					"S"
				]
			},
			"units": "SI throughout: V, A, W, ohm, F, C, s, J; temperatures in degC, thermal resistance in degC/W",
			"absolute_maximum": {
				"conditions": "TA = 25 degC",
				"vds_max": 30,
				"vgs_max": 10,
				"id_continuous": 2.3,
				"id_pulsed": 14.8,
				"id_pulsed_max_width": 0.0001,
				"id_pulsed_max_duty": 0.01,
				"pd_max": 0.5,
				"tj_min": -55,
				"tj_max": 150,
				"eas": 0.0021,
				"eas_conditions": "single pulse, ID = 6.5 A, L = 0.1 mH, RG = 25 ohm",
				"esd_hbm": 3000,
				"esd_cdm": 2000,
				"notes": [
					"id_continuous and pd_max assume RthJA = 245 degC/W (datasheet footnote 1).",
					"id_pulsed: pulse width <= 100 us, duty cycle <= 1 % (footnote 2).",
					"vgs_max is listed as 10 V with no sign; the gate has back-to-back ESD diodes, so treat it as |VGS| <= 10 V."
				]
			},
			"thermal": {
				"rth_ja_min_cu": 245,
				"rth_ja_1in2_cu": 85,
				"notes": [
					"Thermal table: 85 degC/W on FR4 with 1 in2 of 2 oz Cu, 245 degC/W with minimum Cu.",
					"The absolute maximum footnote quotes 245 degC/W 'on 1 in2', which contradicts the thermal table; the 2.3 A / 500 mW ratings match 245 degC/W (0.5 W x 245 = 122.5 degC rise to 147.5 degC)."
				]
			},
			"electrical": {
				"conditions": "TA = 25 degC",
				"bv_dss_min": 30,
				"i_dss_max": 0.000001,
				"i_gss_max": 0.000005,
				"vgs_th": {
					"min": 0.7,
					"typ": 0.9,
					"max": 1.2,
					"conditions": "VDS = VGS, ID = 250 uA"
				},
				"rds_on": [
					{
						"vgs": 1.8,
						"id": 0.5,
						"typ": 0.11,
						"max": 0.18
					},
					{
						"vgs": 2.5,
						"id": 0.5,
						"typ": 0.067,
						"max": 0.082
					},
					{
						"vgs": 4.5,
						"id": 0.5,
						"typ": 0.056,
						"max": 0.067
					},
					{
						"vgs": 8,
						"id": 0.5,
						"typ": 0.054,
						"max": 0.064
					}
				],
				"gfs_typ": 5.9,
				"capacitance": {
					"ciss": {
						"typ": 2.67e-10,
						"max": 3.47e-10
					},
					"coss": {
						"typ": 3.1e-11,
						"max": 4.03e-11
					},
					"crss": {
						"typ": 1.5e-11,
						"max": 1.95e-11
					},
					"conditions": "VGS = 0 V, VDS = 15 V, f = 1 MHz"
				},
				"rg_typ": 220,
				"gate_charge": {
					"qg_4v5": {
						"typ": 2.1e-9,
						"max": 2.7e-9
					},
					"qgd": 6.3e-10,
					"qgs": 4.1e-10,
					"qg_th": 1.2e-10,
					"conditions": "VDS = 15 V, ID = 0.5 A"
				},
				"qoss": 1.53e-9,
				"switching": {
					"td_on": 5.9e-8,
					"tr": 1.11e-7,
					"td_off": 2.79e-7,
					"tf": 2.7e-7,
					"conditions": "VDS = 15 V, VGS = 4.5 V, ID = 0.5 A, RG = 0 ohm"
				},
				"body_diode": {
					"vsd": {
						"typ": 0.7,
						"max": 1
					},
					"conditions": "ISD = 0.5 A, VGS = 0 V"
				}
			}
		}
	}
};
