# Every `run:` step of every workflow through `bash -n`: a quote in a comment
# inside `node -e '…'` broke the release step unnoticed (v0.2.0, #20), and
# nothing runs that step before a release. Ruby because the runner has it and
# its YAML parser; no dependency to install.
#
#   ruby scripts/check-workflow-shell.rb
require "yaml"

bad = 0
Dir[File.join(__dir__, "..", ".github", "workflows", "*.yml")].sort.each do |file|
  workflow = YAML.load_file(file)
  (workflow["jobs"] || {}).each do |job_name, job|
    (job["steps"] || []).each do |step|
      script = step["run"] or next
      out = IO.popen(["bash", "-n"], "r+", err: [:child, :out]) do |io|
        io.write(script)
        io.close_write
        io.read
      end
      next if $?.success?
      bad += 1
      puts "#{File.basename(file)} › #{job_name} › #{step['name']}:\n#{out}"
    end
  end
end
puts "workflow shell steps: #{bad.zero? ? 'ok' : "#{bad} broken"}"
exit(bad.zero? ? 0 : 1)
