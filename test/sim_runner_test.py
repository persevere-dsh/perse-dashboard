"""Process ownership tests for the sim harness, without opening a real DSH home."""
import importlib.machinery,importlib.util,pathlib,subprocess,tempfile,unittest,os,signal,sys
script=pathlib.Path(__file__).resolve().parents[1]/'scripts/sim'
loader=importlib.machinery.SourceFileLoader('dashboard_sim',str(script));spec=importlib.util.spec_from_loader(loader.name,loader);sim=importlib.util.module_from_spec(spec);loader.exec_module(sim)
class SimRunnerTest(unittest.TestCase):
 def test_failed_child_is_reported_and_logs_are_retained(self):
  with tempfile.TemporaryDirectory() as tmp:
   log=pathlib.Path(tmp)/'failed.log'
   with self.assertRaisesRegex(RuntimeError,'Command failed'):
    sim.command([sys.executable,'-c','print("fixture-failure");raise SystemExit(7)'],log,os.environ.copy(),3)
   self.assertIn('fixture-failure',log.read_text())
 def test_timeout_reaps_only_the_spawned_group(self):
  with tempfile.TemporaryDirectory() as tmp:
   sibling=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
   try:
    with self.assertRaises(subprocess.TimeoutExpired):
     sim.command([sys.executable,'-c','import time;time.sleep(30)'],pathlib.Path(tmp)/'timeout.log',os.environ.copy(),.15)
    self.assertIsNone(sibling.poll())
   finally:sim.terminate(sibling)
 def test_cleanup_is_repeatable_after_normal_exit(self):
  child=subprocess.Popen([sys.executable,'-c','pass'],start_new_session=True);child.wait();sim.terminate(child);sim.terminate(child)

 def test_background_descendant_is_reaped_even_after_leader_exits(self):
  with tempfile.TemporaryDirectory() as tmp:
   code='import subprocess,sys; subprocess.Popen([sys.executable,"-c","import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)'
   sim.command([sys.executable,'-c',code],pathlib.Path(tmp)/'descendant.log',os.environ.copy(),3)

 def test_transient_group_probe_denial_is_not_mistaken_for_cleanup(self):
  from unittest.mock import Mock,patch
  child=Mock(pid=12345)
  with patch.object(sim.os,'killpg',side_effect=[None,None,PermissionError(),ProcessLookupError()]) as probe:
   self.assertTrue(sim.terminate(child))
   self.assertEqual(probe.call_count,4)
